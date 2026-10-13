/**
 * POST /api/admin/clients/[id]/predict-outcome
 *
 * Admin-only. Runs the pure-function k-NN prediction (no AI) for this client
 * using:
 *   - Auto features from lodgement_analyses (cumulative days late, late
 *     lodgement count, days since last cash payment).
 *   - Auto feature from the latest stored balance sheet
 *     (director-related loans receivable). Read as halves: a year may have a
 *     P&L but no balance sheet, and such a year is skipped.
 *   - Manual features supplied in the request body.
 *
 * Returns 422 with a structured "PREREQUISITES_MISSING" payload when an auto
 * feature can't be sourced — the UI deep-links from that into the relevant
 * setup page (run lodgement analysis, run financials extraction).
 *
 * Cached predictions live in sbr_outcome_predictions (UNIQUE on client_id);
 * re-running overwrites the row, with the practitioner fee staff chose.
 *
 * The training set is the shared one (historicalCases.ts): excluded cases are
 * never used, and a client is never matched with its own past record — a case
 * whose normalised name equals the client's name, company name or trust name
 * is left out. The accuracy text comes from leave-one-out on all cases in use
 * (accuracy.ts), the same figure the Prediction Data page shows.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSupabaseAuthClient, getSupabaseServerClient } from '@/lib/supabase/server'
import { predictSbrOutcome } from '@/lib/sbr/predictOutcome'
import type { SbrPrediction, SbrPredictionInput } from '@/lib/sbr/types'
import { leaveOneOut } from '@/lib/sbr/accuracy'
import { DEFAULT_PRACTITIONER_FEE_RATE, MAX_PRACTITIONER_FEE_RATE } from '@/lib/sbr/fees'
import {
  TRAINING_COLUMNS,
  clientNames,
  trainingSet as toTrainingSet,
  withoutOwnRecord,
  type ClientNameRow,
  type TrainingRow,
} from '@/lib/sbr/historicalCases'
import { loadIcaRows } from '@/lib/sbr/icaRows'
import { storedLateLodgements } from '@/lib/analysis/config'
import {
  creditorDebt,
  describeDecision,
  daysSinceLastPayment as daysSinceLastPaymentOnAccount,
  type CreditorDebt,
  type IcaRow,
} from '@/lib/sbr/creditorDebt'
import { latestBalanceSheet } from '@/lib/financials/statementSelection'
import { loadStoredSlots } from '@/lib/financials/storedStatements'
import type { StoredStatementSlot } from '@/lib/financials/types'

interface Params {
  params: Promise<{ id: string }>
}

async function requireAdmin() {
  const authClient = await getSupabaseAuthClient()
  const {
    data: { user },
    error,
  } = await authClient.auth.getUser()
  if (error) console.error('[requireAdmin] auth error:', error.message)
  if (!user) return null
  if (user.app_metadata?.role === 'client') return null
  return user
}

const BodySchema = z.object({
  /** Staff's own figure for the creditor (ATO) debt, replacing the automatic one. */
  creditorAmount: z.number().nonnegative().nullable().optional(),
  dpn: z.boolean(),
  paymentPlanType: z.enum(['plan', 'upfront']),
  directorLoanAtAppointment: z.boolean(),
  // REMOVED in v2: the director-loan-sent-to-ATO flag
  /** The practitioner fee for this client, e.g. 0.1; default fees.ts. */
  practitionerFeeRate: z.number().min(0).lt(MAX_PRACTITIONER_FEE_RATE).optional(),
})

interface AutoDetectedDirectorLoan {
  detected: boolean | null
  reasoning: string | null
}

/**
 * Auto-detect whether a director loan was on the balance sheet at appointment.
 * Prefers the current-period BS if extracted; falls back to the latest annual
 * balance sheet. Returns null when no balance sheet is available.
 *
 * The detected value is returned alongside the prediction so the UI can
 * pre-fill the checkbox with an "Auto-detected from <source>" caption. The
 * operator can still override before clicking Generate.
 */
function autoDetectDirectorLoanAtAppointment(slots: StoredStatementSlot[]): AutoDetectedDirectorLoan {
  const source = latestBalanceSheet(slots, { preferCurrentPeriod: true })
  if (!source) {
    return { detected: null, reasoning: null }
  }

  const bs = source.balanceSheet
  const directorLoanValue = Number(bs?.nonCurrentAssets?.directorRelatedLoansReceivable ?? 0) || 0

  if (directorLoanValue > 0) {
    const sourceLabel =
      source.slot.sourceColumn === 'current_period'
        ? `current period (${source.slot.periodLabel ?? `FY${source.slot.financialYear}`})`
        : `FY${source.slot.financialYear} balance sheet`
    return {
      detected: true,
      reasoning: `Director-related loan of $${Math.round(directorLoanValue).toLocaleString('en-AU')} detected on ${sourceLabel}.`,
    }
  }

  return {
    detected: false,
    reasoning: 'No director loan line item found on most recent balance sheet.',
  }
}

interface MissingPrerequisite {
  field: string
  blocker: 'lodgement_analyses' | 'financial_statements'
  actionUrl: string
}

interface PredictResponse extends SbrPrediction {
  inputFeatures: SbrPredictionInput
  creditorAmount: number | null
  /** Where the creditor amount came from, and as at when. */
  creditorDebt: CreditorDebt
  computedAt: string
  cached: false
  autoDetectedDirectorLoan: AutoDetectedDirectorLoan
  /** Past cases left out because they are this client's own record. */
  selfMatchExcluded: number
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const admin = await requireAdmin()
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id: clientId } = await params

    const json = await req.json().catch(() => null)
    const parsed = BodySchema.safeParse(json)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body.', details: parsed.error.flatten() },
        { status: 400 },
      )
    }
    const body = parsed.data

    const supabase = getSupabaseServerClient()

    const { data: client } = await supabase
      .from('clients')
      .select('id, name, company_details(company_name, trust_name)')
      .eq('id', clientId)
      .maybeSingle()
    if (!client) {
      return NextResponse.json({ error: 'Client not found.' }, { status: 404 })
    }

    // Most recent lodgement analysis — gives us numLate, cumDays, and the
    // EnrichedRow list we need to derive daysSinceLastPayment.
    const { data: lodgement } = await supabase
      .from('lodgement_analyses')
      .select(
        'id, document_id, number_of_late_lodgements, cumulative_days_late, rows, analysed_at',
      )
      .eq('client_id', clientId)
      .order('analysed_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    // Most recent balance sheet — gives us director loan receivable and the
    // ATO liability that we use as a creditor-amount proxy.
    // A failed read is tolerated as "no financials", as it always was: the
    // prediction still runs, without the director loan and creditor amount.
    const slots = await loadStoredSlots(supabase, clientId).catch((err) => {
      console.error('[POST predict-outcome] statements read failed', err)
      return [] as StoredStatementSlot[]
    })
    const statement = latestBalanceSheet(slots)

    const missing: MissingPrerequisite[] = []
    if (!lodgement) {
      missing.push({
        field: 'cumulativeDaysLate',
        blocker: 'lodgement_analyses',
        actionUrl: `/clients/${clientId}`,
      })
    }
    if (missing.length > 0) {
      return NextResponse.json(
        {
          error: 'PREREQUISITES_MISSING',
          missing,
        },
        { status: 422 },
      )
    }

    // Auto features.
    // Counted now from the stored rows under the late-lodgement setting
    // (analysis/config.ts), the same rule the lodgement report uses.
    const { cumulativeDaysLate, numberOfLateLodgements } = storedLateLodgements(lodgement!.rows, {
      numberOfLateLodgements: lodgement!.number_of_late_lodgements,
      cumulativeDaysLate: lodgement!.cumulative_days_late,
    })
    // Measured to the account's statement date, not today (creditorDebt.ts).
    // Rows saved before the CSV fix carry no balance: re-read from the CSV (icaRows.ts).
    const ica = await loadIcaRows(supabase, lodgement)
    const icaRows: IcaRow[] = ica.rows ?? (lodgement!.rows as unknown as IcaRow[])
    const daysSinceLastPayment = daysSinceLastPaymentOnAccount(icaRows)

    // Director loan receivable — null financial_statements is tolerated; we
    // fall back to 0 and signal it as a soft prerequisite via the absence of
    // suggestedOfferAmount on the response.
    const balanceSheet = statement?.balanceSheet ?? null
    const directorLoanReceivableAmount =
      Number(balanceSheet?.nonCurrentAssets?.directorRelatedLoansReceivable ?? 0) || 0

    // The creditor debt: staff's figure, else the integrated client account,
    // else the balance sheet's ATO-related liabilities — never two added up.
    const debt = creditorDebt({
      icaRows,
      balanceSheet,
      balanceSheetDate: statement?.slot.periodEndDate ?? null,
      balanceSheetLabel: statement ? `FY${statement.slot.financialYear}` : null,
      staffAmount: body.creditorAmount ?? null,
    })
    const creditorAmount = debt.amount
    // The decision, every time: source, amount, date, and why the ATO account was not used.
    console.log(`[creditor-debt] predict client=${clientId} rowsFrom=${ica.from} ${describeDecision(debt)}`)

    // Auto-detect the director loan at appointment from the latest balance
    // sheet. The UI pre-fills the checkbox from this, but the operator's body
    // value is what actually drives the prediction (they can override).
    const autoDetectedDirectorLoan = autoDetectDirectorLoanAtAppointment(slots)

    const inputFeatures: SbrPredictionInput = {
      dpn: body.dpn,
      paymentPlanType: body.paymentPlanType,
      directorLoanAtAppointment: body.directorLoanAtAppointment,
      directorLoanReceivableAmount,
      cumulativeDaysLate,
      numberOfLateLodgements,
      daysSinceLastPayment,
    }

    // Load the historical training set: every case in use (not excluded).
    const { data: rawCases, error: casesError } = await supabase
      .from('sbr_historical_cases')
      .select(TRAINING_COLUMNS)
    const inUse = toTrainingSet((rawCases ?? []) as unknown as TrainingRow[])

    // Never match the client with its own past record.
    const trainingSet = withoutOwnRecord(inUse, clientNames(client as unknown as ClientNameRow))
    const selfMatchExcluded = inUse.length - trainingSet.length

    if (casesError || trainingSet.length === 0) {
      console.error('[POST predict-outcome] failed to load training set', casesError)
      return NextResponse.json(
        { error: 'Historical training set is unavailable.' },
        { status: 500 },
      )
    }

    const practitionerFeeRate = body.practitionerFeeRate ?? DEFAULT_PRACTITIONER_FEE_RATE
    const prediction = predictSbrOutcome(inputFeatures, trainingSet, {
      creditorAmount: creditorAmount ?? undefined,
      sbrPractitionerFeeRate: practitionerFeeRate,
      accuracy: leaveOneOut(inUse),
    })

    const now = new Date().toISOString()

    const { error: upsertError } = await supabase
      .from('sbr_outcome_predictions')
      .upsert(
        {
          client_id: clientId,
          input_features: inputFeatures as unknown as Record<string, unknown>,
          predicted_outcome_percent: prediction.predictedOutcomePercent,
          predicted_low_percent: prediction.predictedLowPercent,
          predicted_high_percent: prediction.predictedHighPercent,
          comparable_case_ids: prediction.comparableCases.map((c) => c.id),
          training_set_size: prediction.trainingSetSize,
          practitioner_fee_rate: practitionerFeeRate,
          computed_at: now,
        },
        { onConflict: 'client_id' },
      )

    if (upsertError) {
      console.error('[POST predict-outcome] upsert failed', upsertError)
      return NextResponse.json({ error: 'Failed to persist prediction.' }, { status: 500 })
    }

    const response: PredictResponse = {
      ...prediction,
      inputFeatures,
      creditorAmount,
      creditorDebt: debt,
      computedAt: now,
      cached: false,
      autoDetectedDirectorLoan,
      selfMatchExcluded,
    }
    return NextResponse.json(response)
  } catch (err) {
    console.error('[POST predict-outcome] unexpected', err)
    return NextResponse.json({ error: 'Failed to compute prediction.' }, { status: 500 })
  }
}
