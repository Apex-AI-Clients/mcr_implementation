/**
 * Synthetic rows for the import tests. No real client names or figures.
 *
 * The base row is consistent: 35.0 C$ × 250,000 ÷ 100,000 = 87.5% share.
 */
import { FIELDS, FIELD_ORDER } from '../headers'
import { nameKey } from '../normalise'
import type { CaseRecord, ExistingCase, ImportField, SourceRow } from '../types'
import { validateRow } from '../validateRow'

export const BASE_CELLS: Record<ImportField, string> = {
  clientName: 'Example Trading Pty Ltd',
  businessType: 'Cafe & Restaurant',
  dpn: 'N',
  numberOfCreditors: '3',
  creditorAmount: '250,000.00',
  outcome: 'Accepted',
  sbrPayment: '100,000.00',
  paymentType: 'Plan',
  directorLoanAtAppointment: 'N',
  directorLoanSentToAto: 'N',
  directorLoanAmount: '0.00',
  cumulativeDaysLate: '450',
  numberOfLateLodgements: '9',
  daysSinceLastPayment: '120',
  centsInDollar: '35.0',
}

let rowNumber = 1

export function sourceRow(
  overrides: Partial<Record<ImportField, unknown>> = {},
  tab: string | null = 'Sheet A',
): SourceRow {
  const cells = { ...BASE_CELLS, ...overrides }
  rowNumber += 1
  return {
    ref: { tab, rowNumber },
    cells,
    raw: Object.fromEntries(FIELD_ORDER.map((f) => [FIELDS[f].header, String(cells[f] ?? '')])),
  }
}

export function validated(overrides: Partial<Record<ImportField, unknown>> = {}, tab: string | null = 'Sheet A') {
  return validateRow(sourceRow(overrides, tab))
}

let caseNumber = 0

/** A stored case built from the same cells, as the loader would return it. */
export function existingCase(
  overrides: Partial<Record<ImportField, unknown>> = {},
  stored: Partial<CaseRecord> & Partial<Pick<ExistingCase, 'excluded' | 'excluded_reason'>> = {},
): ExistingCase {
  const row = validated(overrides)
  if (!row.record) throw new Error(`fixture row invalid: ${row.reasons.map((r) => r.code).join(', ')}`)
  const { excluded = false, excluded_reason = null, ...columns } = stored
  caseNumber += 1
  return {
    id: `00000000-0000-4000-8000-${String(caseNumber).padStart(12, '0')}`,
    name_key: nameKey(row.record.client_name),
    excluded,
    excluded_reason,
    // Seeded cases have no details and no raw row.
    record: { ...row.record, business_type: null, number_of_creditors: null, raw: null, ...columns },
  }
}

/** Cells as a CSV line, in template order. */
export function csvLine(cells: Partial<Record<ImportField, string>>): string {
  return FIELD_ORDER.map((f) => {
    const v = cells[f] ?? ''
    return /[",]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
  }).join(',')
}

export const TEMPLATE_HEADER = FIELD_ORDER.map((f) => FIELDS[f].header).join(',')
