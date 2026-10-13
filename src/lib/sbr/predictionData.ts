/**
 * Everything the Prediction Data page shows, read in one place on the server:
 * the stats, the leave-one-out accuracy and risk-band evidence, how the
 * dataset grew per upload, the upload history and the case list.
 */
import type { getSupabaseServerClient } from '@/lib/supabase/server'
import { formatDate } from '@/lib/utils'
import { leaveOneOut, type LeaveOneOutResult } from './accuracy'
import { TRAINING_COLUMNS, trainingSet, type TrainingRow } from './historicalCases'
import { NO_PAYMENTS_EVER_DAYS, SHARE_CHECK } from './import/config'
import { listImports, type ImportHistoryEntry } from './import/store'

type ServerClient = ReturnType<typeof getSupabaseServerClient>

export interface PredictionCaseRow {
  id: string
  clientName: string
  accepted: boolean
  /** C/$ */
  outcomePercent: number
  /** C$ × creditor ÷ payment; outside 80–110% the row carries a data check. */
  share: number
  dataCheck: boolean
  excluded: boolean
  excludedReason: string | null
  /** The upload that added it, or null for the initial data. */
  importId: string | null
  sourceLabel: string
  /** What the prediction sees about this case (its 7 factors). */
  factors: CaseFactors
  creditorAmount: number
  sbrPayment: number
  /** From the workbook, where it had one (null for most initial cases). */
  businessType: string | null
}

export interface CaseFactors {
  dpn: boolean
  paymentPlanType: 'plan' | 'upfront'
  directorLoanAtAppointment: boolean
  directorLoanReceivableAmount: number
  cumulativeDaysLate: number
  numberOfLateLodgements: number
  /** Null for "no payments ever". */
  daysSinceLastPayment: number | null
}

export interface GrowthPoint {
  /** "Initial data" or the upload's date. */
  label: string
  at: string
  total: number
  accepted: number
  rejected: number
  /** Leave-one-out typical miss with the cases in use at that point (today's figures). */
  accuracy: number | null
}

export interface PredictionDataStats {
  total: number
  accepted: number
  rejected: number
  /** The latest upload still in force, or null when only the initial data is in. */
  lastUploadAt: string | null
  lastUploadBy: string | null
  /** Cases the latest upload added. */
  lastUploadAdded: number | null
  /** Cases that came with the initial data (not from an upload). */
  initialCases: number
  /** Cases flagged with a data check (payment and C/$ disagree); still in use. */
  dataChecks: number
}

export interface PredictionData {
  stats: PredictionDataStats
  accuracy: LeaveOneOutResult | null
  growth: GrowthPoint[]
  history: ImportHistoryEntry[]
  cases: PredictionCaseRow[]
}

type CaseRow = TrainingRow & {
  business_type: string | null
  import_id: string | null
  excluded_reason: string | null
  added_at: string
}

export async function loadPredictionData(supabase: ServerClient): Promise<PredictionData> {
  const [casesResult, history] = await Promise.all([
    supabase
      .from('sbr_historical_cases')
      .select(`${TRAINING_COLUMNS}, business_type, import_id, excluded_reason, added_at`)
      .order('client_name', { ascending: true }),
    listImports(supabase),
  ])
  if (casesResult.error) throw new Error(`sbr_historical_cases read failed: ${casesResult.error.message}`)
  const rows = (casesResult.data ?? []) as unknown as CaseRow[]

  const inUse = trainingSet(rows)
  const accepted = inUse.filter((c) => c.accepted).length
  const inForce = history.filter((h) => h.undoneAt === null)

  const cases = caseRows(rows, history)

  return {
    stats: {
      total: inUse.length,
      accepted,
      rejected: inUse.length - accepted,
      lastUploadAt: inForce[0]?.uploadedAt ?? null,
      lastUploadBy: inForce[0]?.uploadedBy ?? null,
      lastUploadAdded: inForce[0]?.counts.added ?? null,
      initialCases: inUse.length - rows.filter((r) => !r.excluded && r.import_id !== null).length,
      dataChecks: cases.filter((c) => c.dataCheck && !c.excluded).length,
    },
    accuracy: leaveOneOut(inUse),
    growth: growthPoints(rows, inForce),
    history,
    cases,
  }
}

/** C$ × creditor ÷ payment (0 when the payment is missing). */
export function shareOf(row: Pick<TrainingRow, 'outcome_percent' | 'creditor_amount' | 'sbr_payment'>): number {
  const payment = Number(row.sbr_payment)
  if (!(payment > 0)) return 0
  return ((Number(row.outcome_percent) / 100) * Number(row.creditor_amount)) / payment
}

export function caseRows(rows: readonly CaseRow[], history: readonly ImportHistoryEntry[]): PredictionCaseRow[] {
  const uploads = new Map(history.map((h) => [h.id, h]))
  return rows.map((row) => {
    const share = shareOf(row)
    const upload = row.import_id ? uploads.get(row.import_id) : undefined
    return {
      id: row.id,
      clientName: row.client_name,
      accepted: row.accepted,
      outcomePercent: Number(row.outcome_percent),
      share,
      dataCheck: share < SHARE_CHECK.rejectBelow || share > SHARE_CHECK.rejectAbove,
      excluded: row.excluded,
      excludedReason: row.excluded_reason,
      importId: row.import_id,
      sourceLabel: upload ? `${upload.fileName} · ${formatDate(upload.uploadedAt)}` : 'Initial data',
      factors: {
        dpn: row.dpn,
        paymentPlanType: row.payment_plan_type as CaseFactors['paymentPlanType'],
        directorLoanAtAppointment: row.director_loan_at_appointment,
        directorLoanReceivableAmount: Number(row.director_loan_receivable_amount),
        cumulativeDaysLate: row.cumulative_days_late,
        numberOfLateLodgements: row.number_of_late_lodgements,
        daysSinceLastPayment:
          row.days_since_last_payment >= NO_PAYMENTS_EVER_DAYS ? null : row.days_since_last_payment,
      },
      creditorAmount: Number(row.creditor_amount),
      sbrPayment: Number(row.sbr_payment),
      businessType: row.business_type ?? null,
    }
  })
}

/**
 * Cases in use after the initial data and after each upload still in force,
 * oldest first. Counted from the rows themselves, so an undone upload (whose
 * cases are gone) simply has no point.
 */
export function growthPoints(rows: readonly CaseRow[], inForce: readonly ImportHistoryEntry[]): GrowthPoint[] {
  const used = rows.filter((r) => !r.excluded)
  const tally = (subset: readonly CaseRow[]) => ({
    accepted: subset.filter((r) => r.accepted).length,
    rejected: subset.filter((r) => !r.accepted).length,
  })

  const initial = used.filter((r) => r.import_id === null)
  const firstAdded = initial.reduce<string | null>((min, r) => (min === null || r.added_at < min ? r.added_at : min), null)

  // Accuracy at each point: leave-one-out on the cases in use by then.
  const accuracyOf = (subset: readonly CaseRow[]) => leaveOneOut(trainingSet(subset))?.meanAbsoluteError ?? null

  let running = tally(initial)
  let inUseSoFar: CaseRow[] = [...initial]
  const points: GrowthPoint[] = [
    { label: 'Initial data', at: firstAdded ?? '', total: initial.length, ...running, accuracy: accuracyOf(inUseSoFar) },
  ]
  for (const upload of [...inForce].sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt))) {
    const addedRows = used.filter((r) => r.import_id === upload.id)
    const added = tally(addedRows)
    if (added.accepted + added.rejected === 0) continue
    inUseSoFar = [...inUseSoFar, ...addedRows]
    running = { accepted: running.accepted + added.accepted, rejected: running.rejected + added.rejected }
    points.push({
      label: formatDate(upload.uploadedAt),
      at: upload.uploadedAt,
      total: running.accepted + running.rejected,
      ...running,
      accuracy: accuracyOf(inUseSoFar),
    })
  }
  return points
}
