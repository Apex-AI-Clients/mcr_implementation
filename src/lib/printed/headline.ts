import type { PrintedComparison } from './compare'
import { columnTitle, formatPrinted } from './csv'
import { resolveMeaning, type MappedLine, type MappingEntry } from './mapping'
import type { Meaning } from './meanings'
import { comparisonProof } from './proof'
import type { Suggestions } from './dictionary'
import { audBalance } from '@/lib/ica/types'
import type { IcaHeadlineCell } from '@/lib/ica/balanceAt'

/**
 * The comparison page's headline figures (Gabby, 16 Nov 2026): the only figures it shows, years
 * side by side with the current period as the last column, in this order and wording. Pure; the
 * page and its CSV export both read it, so they never differ.
 *
 * A printed line staff confirmed (or the suggested line, marked, until they do) for every row but
 * "ATO related debt – ICA", which is the ATO's own running balance at each period's end from the
 * verified ATO account (ica/balanceAt.ts). A year that is not proven (proof.ts) is "Being prepared".
 */
export const HEADLINE_ROWS: ({ kind: 'meaning'; meaning: Meaning; label: string } | { kind: 'ica'; label: string })[] = [
  { kind: 'meaning', meaning: 'loan_receivable', label: 'Director loan account (Debit)' },
  { kind: 'meaning', meaning: 'loan_payable', label: 'Loan account director (Credit)' },
  { kind: 'meaning', meaning: 'net_profit', label: 'Net profit' },
  { kind: 'ica', label: 'ATO related debt – ICA' },
  { kind: 'meaning', meaning: 'income_tax_payable', label: 'ATO related debt – Income tax payable' },
  { kind: 'meaning', meaning: 'total_current_assets', label: 'Total current assets' },
  { kind: 'meaning', meaning: 'total_non_current_assets', label: 'Total non-current assets' },
  { kind: 'meaning', meaning: 'total_assets', label: 'Total assets' },
]

export const BEING_PREPARED = 'Being prepared'

export interface IcaHeadline {
  /** 'none': no activity statement account on file; 'held': one is not verified yet. */
  status: 'none' | 'held' | 'ok'
  /** One per comparison column. */
  cells: ({ cell: IcaHeadlineCell } | { none: string })[]
}

export type LineStatus = 'confirmed' | 'suggested' | 'not_found'

export type HeadlineCell =
  | { kind: 'value'; value: number; lines: MappedLine[] }
  | { kind: 'ica'; cell: IcaHeadlineCell }
  /** The year is not proven yet. */
  | { kind: 'held'; reasons: string[] }
  /** Nothing to show: no line, nothing printed that year, or no ATO balance for that date (why). */
  | { kind: 'blank'; why: string | null }

export interface HeadlineRow {
  key: string
  label: string
  /** Null for the ICA row. */
  meaning: Meaning | null
  /** The printed line's state (null for the ICA row). */
  status: LineStatus | null
  /** Confirmed as not printed. */
  notPrinted: boolean
  entries: MappingEntry[]
  cells: HeadlineCell[]
}

export function headlineRows(comparison: PrintedComparison, mapping: MappingEntry[], suggestions: Suggestions, ica: IcaHeadline): HeadlineRow[] {
  const proofs = comparisonProof(comparison)
  const held = (i: number): HeadlineCell | null => (proofs[i]?.status === 'held' ? { kind: 'held', reasons: proofs[i].reasons } : null)
  return HEADLINE_ROWS.map((row) => {
    if (row.kind === 'ica') {
      const cells = comparison.columns.map((_, i): HeadlineCell => {
        if (ica.status === 'none') return { kind: 'blank', why: 'No ATO account on file' }
        if (ica.status === 'held') return { kind: 'held', reasons: ['The ATO account is not verified against its own balance yet'] }
        const c = ica.cells[i]
        return c && 'cell' in c ? { kind: 'ica', cell: c.cell } : { kind: 'blank', why: c?.none ?? null }
      })
      return { key: 'ica', label: row.label, meaning: null, status: null, notPrinted: false, entries: [], cells }
    }
    const entries = mapping.filter((e) => e.meaning === row.meaning)
    const suggestion = suggestions[row.meaning] ?? []
    const status: LineStatus = entries.length ? 'confirmed' : suggestion.length ? 'suggested' : 'not_found'
    const used: MappingEntry[] =
      status === 'confirmed' ? entries : suggestion.map((rowKey) => ({ meaning: row.meaning, rowKey, label: null, nonePrinted: false, confirmedBy: '', confirmedAt: '' }))
    const resolved = resolveMeaning(comparison, used, row.meaning)
    const cells = comparison.columns.map((_, i): HeadlineCell => {
      const h = held(i)
      if (h) return h
      const year = resolved.years[i]
      if (status === 'not_found' || !year || year.value === null) return { kind: 'blank', why: null }
      return { kind: 'value', value: year.value, lines: year.lines }
    })
    return { key: row.meaning, label: row.label, meaning: row.meaning, status, notPrinted: status === 'confirmed' && resolved.status === 'none', entries, cells }
  })
}

const csvCell = (value: string): string => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value)
const csvRow = (...cells: string[]) => cells.map(csvCell).join(',')

/** The page's CSV: the headline figures only, as shown (a suggested line marked). */
export function headlineCsv(input: { clientName: string; comparison: PrintedComparison; rows: HeadlineRow[] }): string {
  const heads = input.comparison.columns.map(columnTitle)
  const lines = [
    csvRow('Financial statements — headline figures', input.clientName),
    csvRow('Generated', new Date().toISOString()),
    '',
    csvRow('Figure', ...heads.map((h) => `${h.title} (${h.period})`), 'Note'),
  ]
  for (const r of input.rows) {
    const note = r.status === 'suggested' ? 'Suggested line, not confirmed yet' : r.status === 'not_found' ? 'No printed line matched' : r.notPrinted ? 'Not printed' : ''
    lines.push(
      csvRow(
        r.label,
        ...r.cells.map((c) => (c.kind === 'value' ? formatPrinted(c.value) : c.kind === 'ica' ? audBalance(Math.round(c.cell.value * 100)) : c.kind === 'held' ? BEING_PREPARED : '')),
        note,
      ),
    )
  }
  return lines.join('\r\n')
}
