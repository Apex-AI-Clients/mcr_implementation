import { notFound } from 'next/navigation'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { OutcomePredictionClient } from './OutcomePredictionClient'
import type { ExtractedBalanceSheet } from '@/lib/financials/types'
import type { EnrichedRow } from '@/lib/analysis/types'
import type { Json } from '@/types/database'
import { differenceInCalendarDays } from 'date-fns'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
}

export default async function OutcomePredictionPage({ params }: Props) {
  const { id } = await params
  const supabase = getSupabaseServerClient()

  const { data: client } = await supabase
    .from('clients')
    .select('id, name')
    .eq('id', id)
    .maybeSingle()
  if (!client) notFound()

  const [lodgement, statement, cached] = await Promise.all([
    supabase
      .from('lodgement_analyses')
      .select('id, number_of_late_lodgements, cumulative_days_late, rows, analysed_at')
      .eq('client_id', id)
      .order('analysed_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('financial_statements')
      .select('financial_year, balance_sheet')
      .eq('client_id', id)
      .order('financial_year', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('sbr_outcome_predictions')
      .select('*')
      .eq('client_id', id)
      .maybeSingle(),
  ])

  const balanceSheet = (statement.data?.balance_sheet ?? null) as ExtractedBalanceSheet | null

  // Auto-detect the director loan at appointment from the latest balance sheet
  // so the manual checkbox pre-fills on first load. The operator can override.
  const directorLoanValue =
    Number(balanceSheet?.nonCurrentAssets?.directorRelatedLoansReceivable ?? 0) || 0
  const directorLoanDetected: boolean | null = balanceSheet ? directorLoanValue > 0 : null
  const directorLoanReasoning: string | null = !balanceSheet
    ? null
    : directorLoanValue > 0
      ? `Director-related loan of $${Math.round(directorLoanValue).toLocaleString('en-AU')} detected on ${
          statement.data?.financial_year ? `FY${statement.data.financial_year} balance sheet` : 'most recent balance sheet'
        }.`
      : 'No director loan line item found on most recent balance sheet.'

  const initialAuto = {
    cumulativeDaysLate: lodgement.data?.cumulative_days_late ?? null,
    numberOfLateLodgements: lodgement.data?.number_of_late_lodgements ?? null,
    daysSinceLastPayment: lodgement.data
      ? deriveDaysSinceLastPayment(lodgement.data.rows as unknown as EnrichedRow[])
      : null,
    directorLoanReceivableAmount: directorLoanValue,
    directorLoanDetected,
    directorLoanReasoning,
    creditorAmount: balanceSheet
      ? Number(balanceSheet.currentLiabilities?.atoLiability ?? 0) || null
      : null,
    latestFinancialYear: statement.data?.financial_year ?? null,
    hasLodgement: Boolean(lodgement.data),
    hasFinancials: Boolean(statement.data),
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <OutcomePredictionClient
        clientId={id}
        clientName={client.name}
        initialAuto={initialAuto}
        initialPrediction={cached.data ? serialiseCachedPrediction(cached.data) : null}
      />
    </div>
  )
}

interface CachedRow {
  input_features: Json
  predicted_outcome_percent: number
  predicted_low_percent: number
  predicted_high_percent: number
  comparable_case_ids: string[]
  training_set_size: number
  computed_at: string
}

function serialiseCachedPrediction(row: CachedRow) {
  return {
    inputFeatures: row.input_features as unknown as Record<string, unknown>,
    predictedOutcomePercent: Number(row.predicted_outcome_percent),
    predictedLowPercent: Number(row.predicted_low_percent),
    predictedHighPercent: Number(row.predicted_high_percent),
    comparableCaseIds: row.comparable_case_ids,
    trainingSetSize: row.training_set_size,
    computedAt: row.computed_at,
  }
}

function deriveDaysSinceLastPayment(rows: EnrichedRow[] | null): number {
  if (!rows || !Array.isArray(rows)) return 9999
  const payments = rows.filter((r) => r.lodgementType === 'Payment')
  if (payments.length === 0) return 9999

  let latest: Date | null = null
  for (const r of payments) {
    if (!r.processedDate) continue
    const d = r.processedDate instanceof Date ? r.processedDate : new Date(r.processedDate)
    if (!Number.isFinite(d.getTime())) continue
    if (!latest || d.getTime() > latest.getTime()) latest = d
  }
  if (!latest) return 9999

  const diff = differenceInCalendarDays(new Date(), latest)
  return diff < 0 ? 0 : diff
}
