/**
 * The settings the historical-case import runs on (the Prediction Data page).
 *
 * Everything a reviewer might want to change about what the import accepts
 * lives here, in one place, rather than in the validation code.
 */

/**
 * What a director loan written as "Yes (Payable)" means.
 *
 *  - 'treat_as_no' → the company owes the director, not the other way round,
 *    so there is no receivable loan: stored as no loan, amount 0, with the
 *    cell text and amount kept (director_loan_raw / _payable_amount) and the
 *    note "payable loan, treated as not receivable".
 *  - 'reject'      → the row is rejected.
 *
 * 'treat_as_no' was agreed for Gabby's first workbook (13 Oct 2026). In that
 * workbook 13 of the 24 new cases depend on it.
 */
export const DIRECTOR_LOAN_PAYABLE_MODE: DirectorLoanPayableMode = 'treat_as_no'
export type DirectorLoanPayableMode = 'treat_as_no' | 'reject'

/**
 * Cases that must never be imported. Matched on the normalised name, so
 * "Pty Ltd", "&" and punctuation do not matter. A case already in the table
 * with `excluded` set is refused the same way.
 */
export const EXCLUDED_CASES: readonly { name: string; reason: string }[] = [
  { name: 'Future Bicycle Innovations', reason: 'previously confirmed data error' },
  { name: 'Life On Demand', reason: 'previously confirmed data error' },
]

/**
 * The payment / C$ consistency check.
 *
 * share = C$ × creditor amount ÷ SBR payment: the part of the payment that
 * reaches creditors. With the usual 12.5% practitioner fee it is 87.5%.
 * Outside [rejectBelow, rejectAbove] the figures cannot both be right and the
 * row is rejected. Inside it but outside [noteBelow, noteAbove] it is
 * accepted with a note.
 */
export const SHARE_CHECK = {
  rejectBelow: 0.8,
  noteBelow: 0.85,
  noteAbove: 1.0,
  rejectAbove: 1.1,
} as const

/** Upload limits. Checked before the file is parsed. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024
export const ACCEPTED_EXTENSIONS = ['.csv', '.xlsx', '.xls'] as const
/** Rows read per tab, header included; anything beyond is not read. */
export const MAX_ROWS_PER_TAB = 2000
/** How far down a tab the header row may sit. */
export const HEADER_SEARCH_ROWS = 10

/**
 * days_since_last_payment keeps this sentinel for "no payments ever" until
 * the follow-up to migration 0028 drops it (no_payments_ever is generated
 * from it).
 */
export const NO_PAYMENTS_EVER_DAYS = 9999
