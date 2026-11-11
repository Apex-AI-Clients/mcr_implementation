import type { EnrichedRow } from './types'

/**
 * Which lodgements count as late lodgements — ONE setting, read by the
 * lodgement report (count, days, DPN), the outcome prediction and the
 * verified-figures check, so a client is counted the same way everywhere.
 *
 *  - 'originals_and_amendments': original activity statements AND client-
 *    initiated amendments lodged after the period's due date. An amendment is
 *    measured from the ORIGINAL period's due date (the CSV effective date), so
 *    one lodged years later counts hundreds of days.
 *  - 'originals_only': original activity statements only.
 *
 * Client and historical figures must be counted the same way: this is the
 * rule the prediction's historical cases are taken to follow.
 */
export type LateLodgementScope = 'originals_only' | 'originals_and_amendments'

// Originals only (decided 13 Oct 2026, provisional until Tom confirms): an amendment corrects a statement already lodged; it is not a late lodgement.
export const LATE_LODGEMENT_SCOPE: LateLodgementScope = 'originals_only'

/** The rule in words, shown on the lodgement report. */
export const LATE_LODGEMENT_RULE: Record<LateLodgementScope, string> = {
  originals_only: 'Late lodgements: original statements only; amendments listed separately',
  originals_and_amendments: 'Late lodgements: original statements and client-initiated amendments',
}

/** Whether a row is a lodgement that can count as late under the scope. */
export function isCountedLodgement(row: Pick<EnrichedRow, 'lodgementType'>, scope: LateLodgementScope = LATE_LODGEMENT_SCOPE): boolean {
  return row.lodgementType === 'Original' || (scope === 'originals_and_amendments' && row.lodgementType === 'ClientAmended')
}

/** Whether a row counts as a late lodgement under the scope. */
export function countsAsLate(
  row: Pick<EnrichedRow, 'lodgementType' | 'lateLodgeDaysCleaned'>,
  scope: LateLodgementScope = LATE_LODGEMENT_SCOPE,
): boolean {
  return isCountedLodgement(row, scope) && (row.lateLodgeDaysCleaned ?? 0) > 0
}

/**
 * The late-lodgement count and cumulative days late under the scope. Works on
 * analysed rows, including those stored in lodgement_analyses.rows (they keep
 * lodgementType and lateLodgeDaysCleaned).
 */
export function lateLodgementSummary(
  rows: readonly Pick<EnrichedRow, 'lodgementType' | 'lateLodgeDaysCleaned'>[],
  scope: LateLodgementScope = LATE_LODGEMENT_SCOPE,
): { numberOfLateLodgements: number; cumulativeDaysLate: number } {
  const late = rows.filter((r) => countsAsLate(r, scope))
  return {
    numberOfLateLodgements: late.length,
    cumulativeDaysLate: late.reduce((s, r) => s + (r.lateLodgeDaysCleaned ?? 0), 0),
  }
}

/**
 * The late-lodgement figures of a stored analysis, counted now under the
 * setting from its stored rows — what the prediction uses, so a change of
 * setting reaches it without re-analysing. Falls back to the stored columns
 * when the rows are not in the analysed shape.
 */
export function storedLateLodgements(
  rows: unknown,
  stored: { numberOfLateLodgements: number; cumulativeDaysLate: number },
  scope: LateLodgementScope = LATE_LODGEMENT_SCOPE,
): { numberOfLateLodgements: number; cumulativeDaysLate: number } {
  const analysed =
    Array.isArray(rows) &&
    rows.length > 0 &&
    rows.every((r) => r && typeof r === 'object' && typeof (r as EnrichedRow).lodgementType === 'string')
  return analysed ? lateLodgementSummary(rows as EnrichedRow[], scope) : stored
}

/**
 * Rows whose processed or effective date is blank or could not be read. Every
 * row of a genuine ATO export has both, so any such row means the file was
 * changed (usually re-saved in a spreadsheet) and the lateness figures cannot
 * be trusted. Works on parsed rows and on rows stored in lodgement_analyses
 * (dates as ISO strings, or null where the parser of the day could not read them).
 */
export function unparsedDateRows(rows: unknown): number {
  if (!Array.isArray(rows)) return 0
  return rows.filter((r) => {
    const row = r as { processedDate?: unknown; effectiveDate?: unknown } | null
    return !row || !row.processedDate || !row.effectiveDate
  }).length
}

/**
 * What staff see when an activity statement export's dates cannot be read
 * (unparsedDateRows above): the analysis has failed and
 * the prediction does not use it. Here, not beside the parser, so the report
 * card (a client component) can show it without bundling the CSV parser.
 */
export function unparsedDatesMessage(count: number): string {
  return `We couldn't read the dates on ${count} ${count === 1 ? 'row' : 'rows'} of this file — was it edited in Excel? Upload the original ATO download.`
}
