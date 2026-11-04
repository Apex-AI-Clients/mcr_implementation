import { notFound, redirect } from 'next/navigation'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { OutcomePredictionClient } from './OutcomePredictionClient'
import { loadReadiness } from '@/lib/sbr/loadReadiness'
import { loadPrintedComparison } from '@/lib/printed/store'
import { applyAutoMapping, loadMapping, loadRelatedNames } from '@/lib/printed/mappingStore'
import { directorLoanInput } from '@/lib/sbr/directorLoan'
import { predictionFinancials } from '@/lib/printed/mapping'
import { creditorDebt, daysSinceLastPayment, describeDecision, icaDateRange, longDate, type IcaRow } from '@/lib/sbr/creditorDebt'
import { loadIcaRows } from '@/lib/sbr/icaRows'
import { mappedCreditorHints, readSavedCreditors } from '@/lib/sbr/creditors'
import { storedLateLodgements } from '@/lib/analysis/config'
import { DEFAULT_PRACTITIONER_FEE_RATE } from '@/lib/sbr/fees'
import { isPredictionStale, trainingDataChangedAt, type ImportChange } from '@/lib/sbr/staleness'
import {
  dpnNote,
  inputsChanged,
  latest,
  readDirectorLoanOverride,
  resolveAtoDebt,
  resolveDirectorLoan,
} from '@/lib/sbr/inputPrecedence'
import type { Json } from '@/types/database'
import { loadAtoAccounts, loadFactorsSourceNote } from '@/lib/analysis/atoAccount/store'
import { ATO_ACCOUNT_CREDITOR_ROWS, atoAccountCreditorRows } from '@/lib/sbr/creditors'


export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
}

export default async function OutcomePredictionPage({ params }: Props) {
  const { id } = await params
  const supabase = getSupabaseServerClient()

  // The reads run together (one after another, each waited a round trip to
  // the database); what is worked out from them is unchanged. A file that
  // belongs elsewhere is redirected once they are back.
  const [{ data: client }, lodgement, printed, stored, cached, imports, names, readiness] = await Promise.all([
    supabase.from('clients').select('id, name, archived_at, workflow').eq('id', id).maybeSingle(),
    supabase
      .from('lodgement_analyses')
      .select('id, document_id, number_of_late_lodgements, cumulative_days_late, rows, analysed_at, statement_label')
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
    loadRelatedNames(supabase, id),
    // What the prediction is waiting for, and its DPN factor (readiness.ts).
    loadReadiness(supabase, id),
  ])
  if (!client) notFound()
  // An archived file is viewed, read-only, in the Archive, and so is the SBR
  // record of a file moved to CVL (the prediction is SBR only).
  if (client.archived_at || client.workflow === 'cvl') redirect(`/sbr/archive/${client.id}`)
  const changedAt = trainingDataChangedAt((imports.data ?? []) as ImportChange[])

  // Three reads that need only the activity statement analysis, together:
  // the account rows behind the creditor debt (rows saved before the CSV fix
  // carry no balance and are re-read from the CSV, icaRows.ts), which account
  // the factors come from when there are two (001 and 002), and the other ATO
  // accounts (behind a setting, off until confirmed).
  const [ica, factorsSource, atoAccountRows] = await Promise.all([
    loadIcaRows(supabase, lodgement.data ?? null),
    loadFactorsSourceNote(supabase, id, lodgement.data?.statement_label ?? null),
    ATO_ACCOUNT_CREDITOR_ROWS
      ? loadAtoAccounts(supabase, id).then((o) => atoAccountCreditorRows(o.accounts, lodgement.data?.statement_label ?? null))
      : Promise.resolve([]),
  ])
  const dpnItem = readiness.items.find((i) => i.key === 'dpn')

  // Staff choices, and the auto-selections for the rest (autoMapping.ts).
  const { mapping } = await applyAutoMapping(supabase, id, printed, stored, names)
  const financials = predictionFinancials(printed.comparison, mapping, names)
  // The loan account figures the predict route uses (sbr/directorLoan.ts): gross by default.
  const loanInput = directorLoanInput(financials)
  const bsColumn = financials.balanceSheet?.column ?? null

  // The same creditor debt and payment gap the predict route uses (creditorDebt.ts).
  const icaRows = (ica.rows ?? lodgement.data?.rows ?? null) as unknown as IcaRow[] | null
  const debt = creditorDebt({
    icaRows,
    mappedAto: financials.atoDebt ? { amount: financials.atoDebt.amount, lines: financials.atoDebt.lines.map((l) => l.label) } : null,
    balanceSheetDate: bsColumn?.periodEnd ?? null,
    balanceSheetLabel: financials.balanceSheet?.label ?? null,
  })
  console.log(`[creditor-debt] page client=${id} rowsFrom=${ica.from} ${describeDecision(debt)}`)

  // When each piece of evidence last changed: the lines confirmed for it, or
  // the statements read. A saved value older than that gives way (inputPrecedence.ts).
  const confirmedAt = (meaning: string) => latest(...mapping.filter((m) => m.meaning === meaning).map((m) => m.confirmedAt))
  const savedRow = cached.data
  const savedFeatures = (savedRow?.input_features ?? {}) as Record<string, unknown>
  const savedCreditors = readSavedCreditors(savedRow?.creditors ?? null)

  // The director loan at appointment follows the amount owed to the company,
  // from the loan lines staff confirmed on the latest balance sheet. Not
  // identified is said so, never shown as $0 (mapping.ts notIdentified).
  const loan = loanInput.notIdentified ? null : financials.loanReceivable
  const directorLoanValue = loanInput.amount
  const directorLoanDetected: boolean | null = loan ? directorLoanValue > 0 : null
  const directorLoanReasoning: string | null = loanInput.notIdentified
    ? null
    : !loan
      ? null
      : directorLoanValue > 0
        ? `Loan owed to the company of $${Math.round(directorLoanValue).toLocaleString('en-AU')} on the ${loan.source}: ${loanInput.receivableLines.map((l) => `“${l.label}”`).join(' + ')}.`
        : `No loan owed to the company on the ${loan.source}.`

  const directorLoan = resolveDirectorLoan(
    savedRow && typeof savedFeatures.directorLoanAtAppointment === 'boolean' ? savedFeatures.directorLoanAtAppointment : null,
    readDirectorLoanOverride(savedRow?.input_overrides ?? null),
    {
      detected: directorLoanDetected,
      amount: directorLoanValue,
      asOf: loan?.asOf ?? null,
      lines: loanInput.receivableLines.map((l) => l.label),
      changedAt: latest(confirmedAt('loan_receivable'), printed.builtAt),
    },
  )
  const ato = resolveAtoDebt(savedCreditors, savedRow?.computed_at ?? null, {
    amount: debt.amount,
    description: debt.description,
    changedAt: debt.source === 'ica' ? (lodgement.data?.analysed_at ?? null) : latest(confirmedAt('ato_debt'), printed.builtAt),
  })

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
    directorLoanAsOf: loanInput.asOf,
    // Gross, payable and net, the printed lines behind them, and why it is not identified (sbr/directorLoan.ts).
    directorLoan: loanInput,
    mappingUrl: `/clients/${id}/financials-comparison/mapping`,
    atoDebtNotIdentified: debt.source === 'ica' ? null : (financials.notIdentified.atoDebt?.message ?? null),
    // Where the page starts: fresh evidence over a stale saved value, with a note.
    directorLoanInitial: directorLoan,
    atoDebtNote: ato.note,
    dpnNote: dpnNote(savedRow && typeof savedFeatures.dpn === 'boolean' ? savedFeatures.dpn : null, readiness.dpn),
    creditorAmount: debt.amount,
    creditorSource: debt.description,
    creditorMissing: debt.missing,
    latestFinancialYear: bsColumn?.financialYear ?? null,
    hasLodgement: Boolean(lodgement.data),
    hasFinancials: printed.comparison.tables.length > 0,
    // Creditors in the SBR: hints from the confirmed lines (latest balance sheet), and the rows saved last time.
    creditorHints: mappedCreditorHints(financials),
    // A typed ATO debt only while it still stands.
    savedCreditors: savedCreditors && !ato.note ? savedCreditors : savedCreditors && { ...savedCreditors, atoDebtEdited: false },
  }

  // The saved prediction ran with inputs the evidence now contradicts: shown
  // as "Inputs changed — re-run", and not re-run on its own.
  const changed = savedRow
    ? inputsChanged(savedFeatures, savedCreditors?.atoDebt, {
        directorLoanAtAppointment: directorLoan.value,
        directorLoanReceivableAmount: directorLoanValue,
        dpn: readiness.dpn,
        cumulativeDaysLate: late?.cumulativeDaysLate ?? null,
        numberOfLateLodgements: late?.numberOfLateLodgements ?? null,
        daysSinceLastPayment: initialAuto.daysSinceLastPayment,
        atoDebt: ato.staffAmount ?? debt.amount,
      })
    : []

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <OutcomePredictionClient
        factorsSource={factorsSource}
        clientId={id}
        clientName={client.name}
        readiness={{
          canPredict: readiness.canPredict,
          waitingFor: readiness.waitingFor,
          dpn: readiness.dpn,
          dpnDetail: dpnItem?.detail ?? '',
        }}
        initialAuto={{ ...initialAuto, atoAccountRows }}
        initialPrediction={cached.data ? { ...serialiseCachedPrediction(cached.data, changedAt), inputsChanged: changed } : null}
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
