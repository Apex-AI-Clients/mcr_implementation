import { notFound, redirect } from 'next/navigation'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { OutcomePredictionClient } from './OutcomePredictionClient'
import { loadReadiness } from '@/lib/sbr/loadReadiness'
import { loadPrintedComparison } from '@/lib/printed/store'
import { loadMapping } from '@/lib/printed/mappingStore'
import { predictionFinancials } from '@/lib/printed/mapping'
import { creditorDebt, daysSinceLastPayment, describeDecision, icaDateRange, longDate, type IcaRow } from '@/lib/sbr/creditorDebt'
import { loadIcaRows } from '@/lib/sbr/icaRows'
import { mappedCreditorHints, readSavedCreditors } from '@/lib/sbr/creditors'
import { storedLateLodgements } from '@/lib/analysis/config'
import { DEFAULT_PRACTITIONER_FEE_RATE } from '@/lib/sbr/fees'
import { isPredictionStale, trainingDataChangedAt, type ImportChange } from '@/lib/sbr/staleness'
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

  const [lodgement, printed, mapping, cached, imports] = await Promise.all([
    supabase
      .from('lodgement_analyses')
      .select('id, document_id, number_of_late_lodgements, cumulative_days_late, rows, analysed_at')
      .eq('client_id', id)
      .order('analysed_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    // The figures: the printed lines staff confirmed, and nothing else (printed/mapping.ts).
    loadPrintedComparison(supabase, id),
    loadMapping(supabase, id),
    supabase
      .from('sbr_outcome_predictions')
      .select('*')
      .eq('client_id', id)
      .maybeSingle(),
    // When the historical cases last changed: a saved prediction older than
    // that is stale (staleness.ts).
    supabase.from('sbr_case_imports').select('uploaded_at, undone_at, counts'),
  ])
  const changedAt = trainingDataChangedAt((imports.data ?? []) as ImportChange[])

  // What the prediction is waiting for, and its DPN factor (readiness.ts).
  const readiness = await loadReadiness(supabase, id)
  const dpnItem = readiness.items.find((i) => i.key === 'dpn')

  const financials = predictionFinancials(printed.comparison, mapping)
  const bsColumn = financials.balanceSheet?.column ?? null

  // The same creditor debt and payment gap the predict route uses (creditorDebt.ts).
  // Rows saved before the CSV fix carry no balance: re-read from the CSV (icaRows.ts).
  const ica = await loadIcaRows(supabase, lodgement.data ?? null)
  const icaRows = (ica.rows ?? lodgement.data?.rows ?? null) as unknown as IcaRow[] | null
  const debt = creditorDebt({
    icaRows,
    mappedAto: financials.atoDebt ? { amount: financials.atoDebt.amount, lines: financials.atoDebt.lines.map((l) => l.label) } : null,
    balanceSheetDate: bsColumn?.periodEnd ?? null,
    balanceSheetLabel: financials.balanceSheet?.label ?? null,
  })
  console.log(`[creditor-debt] page client=${id} rowsFrom=${ica.from} ${describeDecision(debt)}`)

  // The director loan at appointment, from the loan lines staff confirmed on the
  // latest balance sheet, to pre-fill the checkbox. The operator can override.
  const loan = financials.loanReceivable
  const directorLoanValue = Math.max(0, loan?.amount ?? 0)
  const directorLoanDetected: boolean | null = loan ? directorLoanValue > 0 : null
  const directorLoanReasoning: string | null = !loan
    ? financials.confirmed
      ? null
      : 'Confirm which printed lines are the loan accounts first.'
    : directorLoanValue > 0
      ? `Loan owed to the company of $${Math.round(directorLoanValue).toLocaleString('en-AU')} on the ${loan.source}: ${loan.lines.map((l) => `“${l.label}”`).join(' + ')}.`
      : `No loan owed to the company on the ${loan.source}.`

  const late = lodgement.data
    ? storedLateLodgements(lodgement.data.rows, {
        numberOfLateLodgements: lodgement.data.number_of_late_lodgements,
        cumulativeDaysLate: lodgement.data.cumulative_days_late,
      })
    : null

  const initialAuto = {
    // The same count the prediction route makes (analysis/config.ts).
    cumulativeDaysLate: late?.cumulativeDaysLate ?? null,
    numberOfLateLodgements: late?.numberOfLateLodgements ?? null,
    daysSinceLastPayment: lodgement.data ? daysSinceLastPayment(icaRows) : null,
    // The account's whole history, so "no payments" shows what was searched.
    icaHistory: (() => {
      const { first, last } = icaDateRange(icaRows)
      return first && last ? `${longDate(first)} – ${longDate(last)}` : null
    })(),
    directorLoanReceivableAmount: directorLoanValue,
    directorLoanDetected,
    directorLoanReasoning,
    creditorAmount: debt.amount,
    creditorSource: debt.description,
    creditorMissing: debt.missing,
    latestFinancialYear: bsColumn?.financialYear ?? null,
    hasLodgement: Boolean(lodgement.data),
    hasFinancials: printed.comparison.tables.length > 0,
    // Creditors in the SBR: hints from the confirmed lines (latest balance sheet), and the rows saved last time.
    creditorHints: mappedCreditorHints(financials),
    savedCreditors: readSavedCreditors((cached.data as { creditors?: unknown } | null)?.creditors ?? null),
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <OutcomePredictionClient
        clientId={id}
        clientName={client.name}
        readiness={{
          canPredict: readiness.canPredict,
          waitingFor: readiness.waitingFor,
          dpn: readiness.dpn,
          dpnDetail: dpnItem?.detail ?? '',
        }}
        initialAuto={initialAuto}
        initialPrediction={cached.data ? serialiseCachedPrediction(cached.data, changedAt) : null}
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
  practitioner_fee_rate?: number | null
}

function serialiseCachedPrediction(row: CachedRow, changedAt: string | null) {
  return {
    inputFeatures: row.input_features as unknown as Record<string, unknown>,
    predictedOutcomePercent: Number(row.predicted_outcome_percent),
    predictedLowPercent: Number(row.predicted_low_percent),
    predictedHighPercent: Number(row.predicted_high_percent),
    comparableCaseIds: row.comparable_case_ids,
    trainingSetSize: row.training_set_size,
    computedAt: row.computed_at,
    practitionerFeeRate: Number(row.practitioner_fee_rate ?? DEFAULT_PRACTITIONER_FEE_RATE),
    stale: isPredictionStale(row.computed_at, changedAt),
  }
}
