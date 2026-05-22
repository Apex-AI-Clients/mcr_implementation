/**
 * POST /api/admin/clients/[id]/predict-outcome
 *
 * Admin-only. Runs the pure-function k-NN prediction (no AI) for this client
 * using:
 *   - Auto features from lodgement_analyses (cumulative days late, late
 *     lodgement count, days since last cash payment).
 *   - Auto feature from the latest financial_statements row
 *     (director-related loans receivable).
 *   - Manual features supplied in the request body.
 *
 * Returns 422 with a structured "PREREQUISITES_MISSING" payload when an auto
 * feature can't be sourced — the UI deep-links from that into the relevant
 * setup page (run lodgement analysis, run financials extraction).
 *
 * Cached predictions live in sbr_outcome_predictions (UNIQUE on client_id);
 * re-running overwrites the row.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { differenceInCalendarDays } from 'date-fns'
import { getSupabaseAuthClient, getSupabaseServerClient } from '@/lib/supabase/server'
import { predictSbrOutcome } from '@/lib/sbr/predictOutcome'
import type {
  HistoricalSbrCase,
  SbrPrediction,
  SbrPredictionInput,
} from '@/lib/sbr/types'
import type { EnrichedRow } from '@/lib/analysis/types'
import type { ExtractedBalanceSheet } from '@/lib/financials/types'

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
  dpn: z.boolean(),
  paymentPlanType: z.enum(['plan', 'upfront']),
  directorLoanAtAppointment: z.boolean(),
  directorLoanSentToAto: z.boolean(),
})

interface MissingPrerequisite {
  field: string
  blocker: 'lodgement_analyses' | 'financial_statements'
  actionUrl: string
}

interface PredictResponse extends SbrPrediction {
  inputFeatures: SbrPredictionInput
  creditorAmount: number | null
  computedAt: string
  cached: false
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
      .select('id')
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
        'id, number_of_late_lodgements, cumulative_days_late, rows, analysed_at',
      )
      .eq('client_id', clientId)
      .order('analysed_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    // Most recent financial_statements row — gives us director loan receivable
    // and the ATO liability that we use as a creditor-amount proxy.
    const { data: statement } = await supabase
      .from('financial_statements')
      .select('financial_year, balance_sheet')
      .eq('client_id', clientId)
      .order('financial_year', { ascending: false })
      .limit(1)
      .maybeSingle()

    const missing: MissingPrerequisite[] = []
    if (!lodgement) {
      missing.push({
        field: 'cumulativeDaysLate',
        blocker: 'lodgement_analyses',
        actionUrl: `/admin/clients/${clientId}`,
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
    const cumulativeDaysLate = lodgement!.cumulative_days_late
    const numberOfLateLodgements = lodgement!.number_of_late_lodgements
    const daysSinceLastPayment = deriveDaysSinceLastPayment(
      lodgement!.rows as unknown as EnrichedRow[],
    )

    // Director loan receivable — null financial_statements is tolerated; we
    // fall back to 0 and signal it as a soft prerequisite via the absence of
    // suggestedOfferAmount on the response.
    const balanceSheet = (statement?.balance_sheet ?? null) as ExtractedBalanceSheet | null
    const directorLoanReceivableAmount =
      Number(balanceSheet?.nonCurrentAssets?.directorRelatedLoansReceivable ?? 0) || 0

    // ATO liability proxy for creditor amount.
    const creditorAmount = balanceSheet
      ? Number(balanceSheet.currentLiabilities?.atoLiability ?? 0) || null
      : null

    const inputFeatures: SbrPredictionInput = {
      dpn: body.dpn,
      paymentPlanType: body.paymentPlanType,
      directorLoanAtAppointment: body.directorLoanAtAppointment,
      directorLoanSentToAto: body.directorLoanSentToAto,
      directorLoanReceivableAmount,
      cumulativeDaysLate,
      numberOfLateLodgements,
      daysSinceLastPayment,
    }

    // Load the historical training set.
    const { data: rawCases, error: casesError } = await supabase
      .from('sbr_historical_cases')
      .select('*')

    if (casesError || !rawCases || rawCases.length === 0) {
      console.error('[POST predict-outcome] failed to load training set', casesError)
      return NextResponse.json(
        { error: 'Historical training set is unavailable.' },
        { status: 500 },
      )
    }

    const trainingSet: HistoricalSbrCase[] = rawCases.map((row) => ({
      id: row.id,
      clientName: row.client_name,
      features: {
        dpn: row.dpn,
        paymentPlanType: row.payment_plan_type as 'plan' | 'upfront',
        directorLoanAtAppointment: row.director_loan_at_appointment,
        directorLoanSentToAto: row.director_loan_sent_to_ato,
        directorLoanReceivableAmount: Number(row.director_loan_receivable_amount),
        cumulativeDaysLate: row.cumulative_days_late,
        numberOfLateLodgements: row.number_of_late_lodgements,
        daysSinceLastPayment: row.days_since_last_payment,
      },
      outcomePercent: Number(row.outcome_percent),
      accepted: row.accepted,
      creditorAmount: Number(row.creditor_amount),
      sbrPayment: Number(row.sbr_payment),
    }))

    const prediction = predictSbrOutcome(inputFeatures, trainingSet, {
      creditorAmount: creditorAmount ?? undefined,
      mcrFeeRate: 0.1,
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
      computedAt: now,
      cached: false,
    }
    return NextResponse.json(response)
  } catch (err) {
    console.error('[POST predict-outcome] unexpected', err)
    return NextResponse.json({ error: 'Failed to compute prediction.' }, { status: 500 })
  }
}

/**
 * Walk the EnrichedRow array, find cash Payment rows, and return the count of
 * calendar days from the most-recent payment's processedDate to today.
 * Returns 9999 when the client has no payment activity on record.
 */
function deriveDaysSinceLastPayment(rows: EnrichedRow[] | null | undefined): number {
  if (!rows || !Array.isArray(rows)) return 9999
  const payments = rows.filter((r) => r.lodgementType === 'Payment')
  if (payments.length === 0) return 9999

  let latest: Date | null = null
  for (const r of payments) {
    if (!r.processedDate) continue
    // processedDate may arrive as a string from JSON.
    const d = r.processedDate instanceof Date ? r.processedDate : new Date(r.processedDate)
    if (!Number.isFinite(d.getTime())) continue
    if (!latest || d.getTime() > latest.getTime()) latest = d
  }
  if (!latest) return 9999

  const diff = differenceInCalendarDays(new Date(), latest)
  return diff < 0 ? 0 : diff
}
