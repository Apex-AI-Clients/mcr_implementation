/**
 * Shapes for the historical-case import. A case is held in the table's own
 * column names from validation onwards, so what the preview shows is exactly
 * what sbr_apply_case_import stores.
 */

/** Where a row came from: the tab (null for a CSV) and its row number as the
 *  spreadsheet shows it (header = its own row, first data row after it). */
export interface RowRef {
  tab: string | null
  rowNumber: number
}

/** The cells of one row, keyed by the header as written in the file. */
export type RawRow = Record<string, string>

/** One data row read from the file, before validation. */
export interface SourceRow {
  ref: RowRef
  /** Cell values by field; undefined when the file has no such column. */
  cells: Partial<Record<ImportField, unknown>>
  raw: RawRow
}

export type ImportField =
  | 'clientName'
  | 'businessType'
  | 'dpn'
  | 'numberOfCreditors'
  | 'creditorAmount'
  | 'outcome'
  | 'sbrPayment'
  | 'paymentType'
  | 'directorLoanAtAppointment'
  | 'directorLoanSentToAto'
  | 'directorLoanAmount'
  | 'cumulativeDaysLate'
  | 'numberOfLateLodgements'
  | 'daysSinceLastPayment'
  | 'centsInDollar'

/** A case as sbr_historical_cases stores it (the columns an import writes). */
export interface CaseRecord {
  client_name: string
  dpn: boolean
  payment_plan_type: 'plan' | 'upfront'
  term_months: number | null
  director_loan_at_appointment: boolean
  director_loan_raw: string | null
  director_loan_receivable_amount: number
  director_loan_payable_amount: number | null
  cumulative_days_late: number
  number_of_late_lodgements: number
  /** NO_PAYMENTS_EVER_DAYS for "no payments ever" (see config.ts). */
  days_since_last_payment: number
  outcome_percent: number
  accepted: boolean
  creditor_amount: number
  sbr_payment: number
  business_type: string | null
  number_of_creditors: number | null
  raw: RawRow | null
}

export type RejectCode =
  | 'missing_name'
  | 'outcome'
  | 'payment_type'
  | 'dpn'
  | 'director_loan'
  | 'director_loan_payable'
  | 'creditor_amount'
  | 'sbr_payment'
  | 'cents_in_dollar'
  | 'cumulative_days_late'
  | 'number_of_late_lodgements'
  | 'days_since_last_payment'
  | 'payment_exceeds_debt'
  | 'payment_cents_mismatch'
  | 'excluded'
  | 'duplicate_in_file'
  | 'conflicting_repeat'

export type NoteCode =
  | 'payable_loan'
  | 'share_borderline'
  | 'repeat_with_different_figures'
  | 'number_of_creditors_ignored'

/** A plain-English message with a stable code for tests and counting. */
export interface Message<C extends string> {
  code: C
  message: string
}

export type RejectReason = Message<RejectCode>
export type RowNote = Message<NoteCode>

/** The outcome of validating one row on its own (plus the file-level rules). */
export interface ValidatedRow {
  ref: RowRef
  clientName: string
  nameKey: string
  raw: RawRow
  /** Null when the row is rejected. */
  record: CaseRecord | null
  reasons: RejectReason[]
  notes: RowNote[]
  /** C$ × creditor ÷ payment, when the three figures were readable. */
  share: number | null
}

/** A case already in the table, as the import compares against it. */
export interface ExistingCase {
  id: string
  name_key: string
  excluded: boolean
  excluded_reason: string | null
  record: CaseRecord
}

/** One field a correction changes, for the popup's "old → new". */
export interface FieldChange {
  column: keyof CaseRecord
  label: string
  from: string
  to: string
}

export interface NewCase {
  /** The name key, as on Correction. */
  key: string
  ref: RowRef
  record: CaseRecord
  notes: RowNote[]
}

export interface Correction {
  /** The name key: what staff tick, and what the confirm step sends back. */
  key: string
  ref: RowRef
  clientName: string
  /** The case corrected, or null when it corrects a new case in this file. */
  caseId: string | null
  changes: FieldChange[]
  /** What the row would make the case (columns this correction sets). */
  values: Partial<CaseRecord>
  /** What the case holds now in those columns (the preview's view). */
  expected: Partial<CaseRecord>
  notes: RowNote[]
}

export interface AlreadyHave {
  ref: RowRef
  clientName: string
}

/** Business type / number of creditors filled in where the case has none. */
export interface DetailsAdded {
  caseId: string
  clientName: string
  values: Partial<Pick<CaseRecord, 'business_type' | 'number_of_creditors'>>
}

export interface RejectedRow {
  ref: RowRef
  clientName: string
  reasons: RejectReason[]
  raw: RawRow
}

export interface TabSummary {
  /** Null for a CSV. */
  tab: string | null
  status: 'read' | 'skipped'
  /** Data rows read (status 'read'). */
  rows: number
  /** Why a tab was skipped, e.g. the required columns it lacks. */
  detail: string | null
}

export interface ImportCounts {
  added: number
  corrections: number
  already_have: number
  details_added: number
  rejected: number
}

export interface ImportPreview {
  tabs: TabSummary[]
  added: NewCase[]
  corrections: Correction[]
  alreadyHave: AlreadyHave[]
  detailsAdded: DetailsAdded[]
  rejected: RejectedRow[]
  counts: ImportCounts
}
