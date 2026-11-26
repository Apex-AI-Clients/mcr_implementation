import type { EnrichedRow } from './types'
import { dateField } from '@/lib/dates'

/**
 * Pure. The late lodgements the "Number of Late Lodgements" card counts, as
 * the lodgement page lists them under the two top cards (Gabby, 24 Nov 2026,
 * item 10): period, lodged, due, days late, original or amended. The same
 * rows feed Copy, Copy all and the Excel download.
 */

export interface LateLodgementRow {
  rowIndex: number
  /** The period the statement is for (its "period ending"), DD/MM/YYYY; "—" when the description names none. */
  period: string
  /** Lodged: the ATO's processed date. */
  lodged: string
  /** Due: the ATO's effective date. */
  due: string
  daysLate: number
  kind: 'Original' | 'Amended'
  description: string
}

const day = (v: Date | string | null | undefined) => (v ? dateField(v) || '—' : '—')

export function lateLodgementRows(rows: EnrichedRow[]): LateLodgementRow[] {
  return rows.map((r) => ({
    rowIndex: r.rowIndex,
    period: day(r.periodEnding),
    lodged: day(r.processedDate),
    due: day(r.effectiveDate),
    daysLate: r.lateLodgeDaysCleaned,
    kind: r.lodgementType === 'Original' ? 'Original' : 'Amended',
    description: r.description,
  }))
}

/** "Show the 57 late lodgements (46 original, 11 amended)". */
export function lateLodgementsTitle(rows: LateLodgementRow[], open: boolean): string {
  const original = rows.filter((r) => r.kind === 'Original').length
  const amended = rows.length - original
  const parts = amended > 0 ? ` (${original} original, ${amended} amended)` : ''
  return `${open ? 'Hide' : 'Show'} the ${rows.length} late lodgement${rows.length === 1 ? '' : 's'}${parts}`
}

export const LATE_LODGEMENT_HEADERS = ['Period', 'Lodged', 'Due', 'Days late', 'Original / amended', 'Description as printed'] as const

export const lateLodgementCells = (r: LateLodgementRow): (string | number)[] => [r.period, r.lodged, r.due, r.daysLate, r.kind, r.description]

/** Tab-separated, for pasting into a spreadsheet: one row, or all with the headings. */
export const lateLodgementTsv = (r: LateLodgementRow) => lateLodgementCells(r).join('\t')
export const lateLodgementsTsv = (rows: LateLodgementRow[]) => [LATE_LODGEMENT_HEADERS.join('\t'), ...rows.map(lateLodgementTsv)].join('\n')
