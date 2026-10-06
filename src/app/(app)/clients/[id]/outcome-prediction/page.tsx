import { notFound, redirect } from 'next/navigation'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { OutcomePredictionClient } from './OutcomePredictionClient'
import { latestBalanceSheet } from '@/lib/financials/statementSelection'
import { loadStoredSlots } from '@/lib/financials/storedStatements'
import type { StoredStatementSlot } from '@/lib/financials/types'
import { creditorDebt, daysSinceLastPayment, describeDecision, type IcaRow } from '@/lib/sbr/creditorDebt'
import { loadIcaRows } from '@/lib/sbr/icaRows'
import type { Json } from '@/types/database'


export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
}

export default async function OutcomePredictionPage({ params }: Props) {
  const { id } = await params
  const supabase = getSupabaseServerClient()

  const { data: client } = await supabase
    .from('clients')
    .select('id, name, archived_at')
    .eq('id', id)
    .maybeSingle()
  if (!client) notFound()
  // An archived file is viewed, read-only, in the Archive.
  if (client.archived_at) redirect(`/sbr/archive/${client.id}`)

  const [lodgement, slots, cached] = await Promise.all([
    supabase
      .from('lodgement_analyses')
      .select('id, document_id, number_of_late_lodgements, cumulative_days_late, rows, analysed_at')
      .eq('client_id', id)
      .order('analysed_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    // Read as halves: a year may have a P&L but no balance sheet.
    loadStoredSlots(supabase, id).catch(() => [] as StoredStatementSlot[]),
    supabase
      .from('sbr_outcome_predictions')
      .select('*')
      .eq('client_id', id)
      .maybeSingle(),
  ])

  const statement = latestBalanceSheet(slots)
  const balanceSheet = statement?.balanceSheet ?? null

  // The same creditor debt and payment gap the predict route uses (creditorDebt.ts).
  // Rows saved before the CSV fix carry no balance: re-read from the CSV (icaRows.ts).
  const ica = await loadIcaRows(supabase, lodgement.data ?? null)
  const icaRows = (ica.rows ?? lodgement.data?.rows ?? null) as unknown as IcaRow[] | null
  const debt = creditorDebt({
    icaRows,
    balanceSheet,
    balanceSheetDate: statement?.slot.periodEndDate ?? null,
    balanceSheetLabel: statement ? `FY${statement.slot.financialYear}` : null,
  })
  console.log(`[creditor-debt] page client=${id} rowsFrom=${ica.from} ${describeDecision(debt)}`)

  // Auto-detect the director loan at appointment from the latest balance sheet
  // so the manual checkbox pre-fills on first load. The operator can override.
  const directorLoanValue =
    Number(balanceSheet?.nonCurrentAssets?.directorRelatedLoansReceivable ?? 0) || 0
  const directorLoanDetected: boolean | null = balanceSheet ? directorLoanValue > 0 : null
  const directorLoanReasoning: string | null = !balanceSheet
    ? null
    : directorLoanValue > 0
      ? `Director-related loan of $${Math.round(directorLoanValue).toLocaleString('en-AU')} detected on ${
          statement ? `FY${statement.slot.financialYear} balance sheet` : 'most recent balance sheet'
        }.`
      : 'No director loan line item found on most recent balance sheet.'

  const initialAuto = {
    cumulativeDaysLate: lodgement.data?.cumulative_days_late ?? null,
    numberOfLateLodgements: lodgement.data?.number_of_late_lodgements ?? null,
    daysSinceLastPayment: lodgement.data ? daysSinceLastPayment(icaRows) : null,
    directorLoanReceivableAmount: directorLoanValue,
    directorLoanDetected,
    directorLoanReasoning,
    creditorAmount: debt.amount,
    creditorSource: debt.description,
    creditorMissing: debt.missing,
    latestFinancialYear: statement?.slot.financialYear ?? null,
    hasLodgement: Boolean(lodgement.data),
    hasFinancials: slots.length > 0,
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
