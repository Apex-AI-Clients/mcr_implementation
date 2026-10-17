import { csvRow } from '@/lib/csv'
import {
  DPN_EXPORT_SOURCE_NOTE,
  columnLabels,
  describeDaysLeft,
  formatIsoDate,
  typeLabel,
  type DpnSummary,
} from './summary'
import type { DpnAmounts } from './types'

/**
 * The DPN summary as CSV: company totals by type, each notice, per-director
 * totals, then notices still to be entered. Amounts in dollars to the cent,
 * unformatted, so a spreadsheet can add them.
 *
 * Only what the summary holds goes in — the director's name, never an
 * address, which is never stored.
 */

export interface DpnExportMeta {
  clientName: string
  /** Today in Sydney, ISO. Days left are as at this date. */
  asAtIso: string
}

const dollars = (cents: number) => (cents / 100).toFixed(2)
const amounts = (a: DpnAmounts) => [dollars(a.column2), dollars(a.column3), dollars(a.column4), dollars(a.column5)]

export function buildDpnCsv(summary: DpnSummary, meta: DpnExportMeta): string {
  const lines: string[] = [
    csvRow('Director penalty notices'),
    csvRow('Client', meta.clientName),
    csvRow('As at', formatIsoDate(meta.asAtIso)),
    '',
    csvRow('Company totals by type (each period counted once, from the most recently issued notice)'),
    csvRow('Type', 'Column', 'Meaning', 'Amount'),
  ]
  for (const t of summary.companyByType) {
    const labels = columnLabels(t.type, t.earliestDeadline)
    for (const key of ['column3', 'column4', 'column5', 'column2'] as const) {
      lines.push(csvRow(typeLabel(t.type), key.replace('column', 'Column '), labels[key], dollars(t.totals[key])))
    }
  }
  if (summary.companyByType.length > 1) {
    lines.push(csvRow('All types', 'Column 3', 'Unpaid', dollars(summary.company.column3)))
  }

  lines.push(
    '',
    csvRow('Notices'),
    csvRow(
      'Standing',
      'Type',
      'Director',
      'Reference',
      'Date of issue',
      'Deadline',
      'Days left',
      'Column 2',
      'Column 3 (unpaid)',
      'Column 4',
      'Column 5',
      'How it was read',
      'Needs checking',
    ),
  )
  for (const n of summary.notices) {
    lines.push(
      csvRow(
        n.standing === 'current' ? 'Current' : 'History',
        typeLabel(n.type),
        n.directorName,
        n.reference,
        formatIsoDate(n.issuedOn),
        formatIsoDate(n.deadline),
        describeDaysLeft(n.daysLeft),
        ...amounts(n.totals),
        n.source === 'manual' ? 'Entered manually' : 'Read automatically',
        n.issues.join(' '),
      ),
    )
  }

  lines.push('', csvRow('By director (current notices)'), csvRow('Director', 'Type', 'Column 2', 'Column 3 (unpaid)', 'Column 4', 'Column 5'))
  for (const d of summary.directors) {
    for (const t of d.byType) lines.push(csvRow(d.directorName, typeLabel(t.type), ...amounts(t.totals)))
    if (d.byType.length > 1) lines.push(csvRow(d.directorName, 'All types', ...amounts(d.overall)))
  }

  if (summary.waiting.length > 0) {
    lines.push('', csvRow('Not in the totals: waiting to be read or entered manually'), csvRow('File'))
    for (const w of summary.waiting) lines.push(csvRow(w.filename))
  }

  lines.push('', csvRow(DPN_EXPORT_SOURCE_NOTE))
  return lines.join('\r\n')
}
