/**
 * The historical SBR cases as the prediction uses them: one mapping from
 * sbr_historical_cases rows, shared by the predict route and the Prediction
 * Data page so both always see the same training set.
 *
 * Excluded cases (sbr_historical_cases.excluded) are never used, and a client
 * is never matched with its own past record (withoutOwnRecord).
 */
import type { Database } from '@/types/database'
import { nameKey } from './import/normalise'
import type { HistoricalSbrCase } from './types'

type CaseRow = Database['public']['Tables']['sbr_historical_cases']['Row']

/** The columns a training case needs. */
export const TRAINING_COLUMNS =
  'id, client_name, dpn, payment_plan_type, director_loan_at_appointment, director_loan_receivable_amount, cumulative_days_late, number_of_late_lodgements, days_since_last_payment, outcome_percent, accepted, creditor_amount, sbr_payment, excluded'

export type TrainingRow = Pick<
  CaseRow,
  | 'id'
  | 'client_name'
  | 'dpn'
  | 'payment_plan_type'
  | 'director_loan_at_appointment'
  | 'director_loan_receivable_amount'
  | 'cumulative_days_late'
  | 'number_of_late_lodgements'
  | 'days_since_last_payment'
  | 'outcome_percent'
  | 'accepted'
  | 'creditor_amount'
  | 'sbr_payment'
  | 'excluded'
>

export function toHistoricalCase(row: TrainingRow): HistoricalSbrCase {
  return {
    id: row.id,
    clientName: row.client_name,
    features: {
      dpn: row.dpn,
      paymentPlanType: row.payment_plan_type as 'plan' | 'upfront',
      directorLoanAtAppointment: row.director_loan_at_appointment,
      directorLoanReceivableAmount: Number(row.director_loan_receivable_amount),
      cumulativeDaysLate: row.cumulative_days_late,
      numberOfLateLodgements: row.number_of_late_lodgements,
      daysSinceLastPayment: row.days_since_last_payment,
    },
    outcomePercent: Number(row.outcome_percent),
    accepted: row.accepted,
    creditorAmount: Number(row.creditor_amount),
    sbrPayment: Number(row.sbr_payment),
  }
}

/** The cases the prediction may use: every row not excluded. */
export function trainingSet(rows: readonly TrainingRow[]): HistoricalSbrCase[] {
  return rows.filter((row) => !row.excluded).map(toHistoricalCase)
}

/** A clients row with its company details embedded, as the predict route reads it. */
export interface ClientNameRow {
  name: string | null
  company_details:
    | { company_name: string | null; trust_name: string | null }
    | { company_name: string | null; trust_name: string | null }[]
    | null
}

/** The names a client goes by: its own, its company's and its trust's. */
export function clientNames(client: ClientNameRow): string[] {
  const details = Array.isArray(client.company_details)
    ? client.company_details
    : client.company_details
      ? [client.company_details]
      : []
  return [client.name, ...details.flatMap((d) => [d.company_name, d.trust_name])].filter(
    (n): n is string => typeof n === 'string',
  )
}

/**
 * The training set without the client's own past record: a case whose
 * normalised name equals any name the client goes by. (A client already in
 * Gabby's data would otherwise be its own nearest neighbour.)
 */
export function withoutOwnRecord(
  cases: readonly HistoricalSbrCase[],
  names: readonly string[],
): HistoricalSbrCase[] {
  const own = new Set(names.map(nameKey).filter((k) => k !== ''))
  return cases.filter((c) => !own.has(nameKey(c.clientName)))
}
