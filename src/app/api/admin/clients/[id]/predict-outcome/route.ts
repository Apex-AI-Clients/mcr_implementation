/**
 * POST /api/admin/clients/[id]/predict-outcome
 *
 * Admin-only. Runs the pure-function k-NN prediction (no AI) for this client
 * using:
 *   - Auto features from lodgement_analyses (cumulative days late, late
 *     lodgement count, days since last cash payment).
 *   - Auto feature from the latest balance sheet as printed: the loan
 *     account owed to the company, from the lines staff confirmed
 *     (printed/mapping.ts) — the prediction's only source of figures.
 *   - Manual features supplied in the request body.
 *
 * Returns 422 with a structured "PREREQUISITES_MISSING" payload when an auto
 * feature can't be sourced — the UI deep-links from that into the relevant
 * setup page (run lodgement analysis, run financials extraction).
 *
 * Cached predictions live in sbr_outcome_predictions (UNIQUE on client_id);
 * re-running overwrites the row, with the practitioner fee staff chose and
 * the creditors in the SBR (creditors.ts, migration 0032).
 *
 * The offer is sized on the creditor TOTAL: the ATO debt (creditorDebt.ts)
 * plus the other creditor rows staff entered.
 *
 * "Director loan receivable amount" is the confirmed loan lines owed TO the
 * company, gross (or net, one setting: sbr/directorLoan.ts). A loan or ATO
 * line the statements print but nobody mapped is never a silent $0: 422
 * INPUT_NOT_IDENTIFIED, with where to choose the line. "Director loan at
 * appointment" follows the amount; when staff change it, who and when are
 * saved with the prediction (input_overrides, migration 0037). Nothing is
 * refused over the two disagreeing.
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
import { cachedLeaveOneOut } from '@/lib/sbr/accuracy'
import { loadReadiness } from '@/lib/sbr/loadReadiness'
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
import { loadPrintedComparison } from '@/lib/printed/store'
import { loadDirectorNames, loadMapping } from '@/lib/printed/mappingStore'
import { directorLoanInput, type DirectorLoanInput } from '@/lib/sbr/directorLoan'
import { staffAuthorName } from '@/lib/auth/staff'
import { predictionFinancials, type PredictionFinancials } from '@/lib/printed/mapping'
import {
  CREDITOR_KINDS,
  CREDITOR_LABEL_MAX,
  MAX_CREDITOR_ROWS,
  creditorTotal,
  normaliseCreditorRows,
  type CreditorRow,
  readSavedCreditors,
  type SavedCreditors,
} from '@/lib/sbr/creditors'
import {
  latest,
  recordDirectorLoanChange,
  readDirectorLoanOverride,
  type DirectorLoanOverride,
} from '@/lib/sbr/inputPrecedence'

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
  /** Staff's own figure for the ATO debt, replacing the automatic one. */
  creditorAmount: z.number().nonnegative().nullable().optional(),
  /** The other creditors in the SBR (creditors.ts): rows staff added, label and amount. */
  creditors: z
    .array(
      z.object({
        label: z.string().max(CREDITOR_LABEL_MAX * 2),
        amount: z.number().nonnegative().finite().nullable(),
        kind: z.enum(CREDITOR_KINDS).optional(),
      }),
    )
    .max(MAX_CREDITOR_ROWS)
    .optional(),
  /**
   * Staff's answer to "Director Penalty Notice issued?", used ONLY when
   * nothing is on file (readiness.dpn is null): notices uploaded mean Yes,
   * the "none issued" tick means No, whatever this says. Missing means No.
   */
  dpn: z.boolean().optional(),
  paymentPlanType: z.enum(['plan', 'upfront']),
  directorLoanAtAppointment: z.boolean(),
  /** Sent by pages from before 26 Oct 2026; no longer asked for, ignored. */
  directorLoanOverrideReason: z.string().max(1000).optional(),
  // REMOVED in v2: the director-loan-sent-to-ATO flag
  /** The practitioner fee for this client, e.g. 0.1; default fees.ts. */
  practitionerFeeRate: z.number().min(0).lt(MAX_PRACTITIONER_FEE_RATE).optional(),
})

interface AutoDetectedDirectorLoan {
  detected: boolean | null
  reasoning: string | null
}

/**
 * Whether a director loan was on the balance sheet at appointment: the loan
 * lines staff confirmed, on the latest balance sheet as printed (the current
 * period when there is one). Null when they are not identified.
 *
 * Returned alongside the prediction so the UI can pre-fill the checkbox. The
 * operator can still override before clicking Generate.
 */
function autoDetectDirectorLoanAtAppointment(financials: PredictionFinancials, loan: DirectorLoanInput): AutoDetectedDirectorLoan {
  if (loan.notIdentified || !financials.loanReceivable) return { detected: null, reasoning: loan.notIdentified?.message ?? null }
  if (loan.amount > 0) {
    return {
      detected: true,
      reasoning: `Loan owed to the company of $${Math.round(loan.amount).toLocaleString('en-AU')} on the ${loan.source}: ${loan.receivableLines.map((l) => `“${l.label}”`).join(' + ')}.`,
    }
  }
  return { detected: false, reasoning: `No loan owed to the company on the ${loan.source}.` }
}

interface MissingPrerequisite {
  field: string
  blocker: 'lodgement_analyses' | 'financial_statements' | 'line_mapping'
  actionUrl: string
  /** What is missing, in a line ("Not found in the statements — choose the line."). */
  message?: string
}

interface PredictResponse extends SbrPrediction {
  inputFeatures: SbrPredictionInput
  /** The creditor total the offer is sized on: ATO debt + other creditor rows. */
  creditorAmount: number | null
  /** The ATO debt in that total. */
  atoDebt: number | null
  /** Where the ATO debt came from, and as at when. */
  creditorDebt: CreditorDebt
  /** The other creditor rows, as saved. */
  creditors: CreditorRow[]
  computedAt: string
  cached: false
  autoDetectedDirectorLoan: AutoDetectedDirectorLoan
  /** The balance sheet the director loan inputs come from (ISO), for their labels. */
  directorLoanAsOf: string | null
  /** Staff's change to the tick (who and when), when they made one. */
  directorLoanOverride: DirectorLoanOverride | null
  /** The loan account figures: gross, payable, net, and the printed lines behind them. */
  directorLoan: DirectorLoanInput
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

    // Every readiness item finished (Ready or Failed) — the same rule as the
    // checklist and the button (readiness.ts).
    const readiness = await loadReadiness(supabase, clientId)
    if (!readiness.canPredict) {
      return NextResponse.json({ error: 'NOT_READY', waitingFor: readiness.waitingFor }, { status: 422 })
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

    // The financial figures: the printed lines staff confirmed (the readiness
    // gate above has made sure they did), on the latest balance sheet.
    const [{ comparison }, mapping, directors] = await Promise.all([
      loadPrintedComparison(supabase, clientId),
      loadMapping(supabase, clientId),
      loadDirectorNames(supabase, clientId),
    ])
    const financials = predictionFinancials(comparison, mapping, { directors })
    const loan = directorLoanInput(financials)

    const missing: MissingPrerequisite[] = []
    if (!lodgement) {
      missing.push({
        field: 'cumulativeDaysLate',
        blocker: 'lodgement_analyses',
        actionUrl: `/clients/${clientId}`,
      })
    }
    // A loan line the statements print that nobody mapped: ask, never assume $0.
    if (loan.notIdentified) {
      missing.push({
        field: 'directorLoanReceivableAmount',
        blocker: 'line_mapping',
        actionUrl: `/clients/${clientId}/financials-comparison/mapping`,
        message: loan.notIdentified.message,
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

    // The loan account owed to the company (gross by default; directorLoan.ts).
    const directorLoanReceivableAmount = loan.amount
    const directorLoanAsOf = loan.asOf

    // What was saved last time: the override's original time and the ATO
    // debt staff typed are carried over unchanged when they are sent again.
    const { data: stored } = await supabase
      .from('sbr_outcome_predictions')
      .select('creditors, input_overrides, computed_at')
      .eq('client_id', clientId)
      .maybeSingle()
    const now = new Date().toISOString()

    // The tick follows the amount; a staff change is recorded, never refused.
    const loanOverride = {
      override: recordDirectorLoanChange({
        value: body.directorLoanAtAppointment,
        amount: directorLoanReceivableAmount,
        stored: readDirectorLoanOverride(stored?.input_overrides ?? null),
        by: staffAuthorName(admin),
        now,
      }),
    }

    // The creditor debt: staff's figure, else the integrated client account,
    // else the balance sheet's ATO-related liabilities — never two added up.
    const debt = creditorDebt({
      icaRows,
      mappedAto: financials.atoDebt ? { amount: financials.atoDebt.amount, lines: financials.atoDebt.lines.map((l) => l.label) } : null,
      balanceSheetDate: financials.balanceSheet?.column.periodEnd ?? null,
      balanceSheetLabel: financials.balanceSheet?.label ?? null,
      staffAmount: body.creditorAmount ?? null,
    })
    const atoDebt = debt.amount
    // The ATO debt would come from the balance sheet, which prints an ATO line nobody mapped.
    if (financials.notIdentified.atoDebt && debt.source !== 'ica' && debt.source !== 'staff') {
      return NextResponse.json(
        {
          error: 'PREREQUISITES_MISSING',
          missing: [
            {
              field: 'atoDebt',
              blocker: 'line_mapping',
              actionUrl: `/clients/${clientId}/financials-comparison/mapping`,
              message: financials.notIdentified.atoDebt.message,
            },
          ],
        },
        { status: 422 },
      )
    }
    // No rows sent (an older page): none, rather than the defaults.
    const creditorRows = normaliseCreditorRows(body.creditors ?? [])
    const creditorAmount = creditorTotal(atoDebt, creditorRows)
    const savedCreditors: SavedCreditors = {
      atoDebt,
      atoDebtEdited: debt.source === 'staff',
      ...(debt.source === 'staff' ? staffAtoStamp(readSavedCreditors(stored?.creditors ?? null), stored?.computed_at ?? null, debt.amount, now, () =>
        creditorDebt({
          icaRows,
          mappedAto: financials.atoDebt ? { amount: financials.atoDebt.amount, lines: financials.atoDebt.lines.map((l) => l.label) } : null,
        }).amount,
      ) : {}),
      rows: creditorRows,
    }
    // The decision, every time: source, amount, date, and why the ATO account was not used.
    console.log(`[creditor-debt] predict client=${clientId} rowsFrom=${ica.from} ${describeDecision(debt)}`)

    // Auto-detect the director loan at appointment from the latest balance
    // sheet. The UI pre-fills the checkbox from this, but the operator's body
    // value is what actually drives the prediction (they can override).
    const autoDetectedDirectorLoan = autoDetectDirectorLoanAtAppointment(financials, loan)

    const inputFeatures: SbrPredictionInput = {
      dpn: readiness.dpn ?? body.dpn ?? false,
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
      accuracy: cachedLeaveOneOut(inUse),
    })

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
          creditors: savedCreditors as unknown as Record<string, unknown>,
          total_creditor_amount: creditorAmount,
          input_overrides: loanOverride.override
            ? ({ directorLoanAtAppointment: loanOverride.override } as unknown as Record<string, unknown>)
            : null,
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
      atoDebt,
      creditorDebt: debt,
      creditors: creditorRows,
      computedAt: now,
      cached: false,
      autoDetectedDirectorLoan,
      directorLoanAsOf,
      directorLoanOverride: loanOverride.override,
      directorLoan: loan,
      selfMatchExcluded,
    }
    return NextResponse.json(response)
  } catch (err) {
    console.error('[POST predict-outcome] unexpected', err)
    return NextResponse.json({ error: 'Failed to compute prediction.' }, { status: 500 })
  }
}

/**
 * When staff typed the ATO debt, and the automatic figure they typed over
 * (inputPrecedence.ts). The same amount sent again keeps the original time,
 * so re-running does not make an old figure look newer than the evidence;
 * saved before the time was kept, the last prediction's time stands in.
 */
function staffAtoStamp(
  stored: SavedCreditors | null,
  storedComputedAt: string | null,
  amount: number | null,
  now: string,
  automatic: () => number | null,
): Pick<SavedCreditors, 'atoDebtEditedAt' | 'atoDebtAuto'> {
  if (stored?.atoDebtEdited && stored.atoDebt === amount) {
    const editedAt = latest(stored.atoDebtEditedAt) ?? storedComputedAt
    return {
      ...(editedAt ? { atoDebtEditedAt: editedAt } : {}),
      ...(stored.atoDebtAuto !== undefined ? { atoDebtAuto: stored.atoDebtAuto } : {}),
    }
  }
  return { atoDebtEditedAt: now, atoDebtAuto: automatic() }
}
