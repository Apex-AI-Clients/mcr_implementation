import type { PrintedComparison } from './compare'
import { columnTitle, formatPrinted } from './csv'
import { periodSourceCsv } from './periodSourceText'
import { dateTimeText } from '@/lib/dates'
import { loanSideConflicts, loanSidesAt, resolveMeaning, type MappedLine, type MappingEntry } from './mapping'
import type { Meaning } from './meanings'
import { comparisonProof } from './proof'
import { assetSectionTotals, personAccount, personKey, type Suggestions } from './dictionary'
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
  /** `note`: said in its ⓘ ("As printed: current assets include an overdrawn bank account (−$47,964)"). */
  | { kind: 'value'; value: number; lines: MappedLine[]; note?: string }
  | { kind: 'ica'; cell: IcaHeadlineCell }
  /** The year is not proven yet. */
  | { kind: 'held'; reasons: string[] }
  /** Nothing to show: no line, nothing printed that year, or no ATO balance for that date (why). */
  | { kind: 'blank'; why: string | null; conflict?: boolean }

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

/** Said in the ⓘ of an income tax payable figure printed below zero (Gabby, 25 Nov 2026). */
export const NEGATIVE_LIABILITY_NOTE = 'Printed as a negative liability'

export function headlineRows(comparison: PrintedComparison, mapping: MappingEntry[], suggestions: Suggestions, ica: IcaHeadline): HeadlineRow[] {
  const proofs = comparisonProof(comparison)
  const held = (i: number): HeadlineCell | null => (proofs[i]?.status === 'held' ? { kind: 'held', reasons: proofs[i].reasons } : null)
  const sections = assetSectionTotals(comparison.tables.find((t) => t.kind === 'balance_sheet')?.rows ?? [], comparison.columns.length)
  const sectionRules = new Map([...sections.current, ...sections.nonCurrent].filter((l) => !l.possible).map((l) => [l.rowKey, l.rule]))
  const usedFor = (meaning: Meaning) => {
    const entries = mapping.filter((e) => e.meaning === meaning)
    const suggestion = suggestions[meaning] ?? []
    const status: LineStatus = entries.length ? 'confirmed' : suggestion.length ? 'suggested' : 'not_found'
    // A suggested asset section total carries its rule, so sections proven together are added up (mapping.ts).
    const sectionRule = (rowKey: string) => (meaning === 'total_current_assets' || meaning === 'total_non_current_assets' ? (sectionRules.get(rowKey) ?? null) : null)
    const used: MappingEntry[] =
      status === 'confirmed' ? entries : suggestion.map((rowKey) => ({ meaning, rowKey, label: null, nonePrinted: false, confirmedBy: '', confirmedAt: '', autoRule: sectionRule(rowKey) }))
    return { entries, status, used }
  }
  // One account per person (mapping.ts groupPersons): when the loan lines include a person's own
  // account lines, both loan rows come from the per-person sides, as the prediction reads them.
  const loanUsed = [...usedFor('loan_receivable').used, ...usedFor('loan_payable').used]
  const rows = comparison.tables.flatMap((t) => t.rows)
  const personCounts = new Map<string, number>()
  for (const e of loanUsed) {
    const p = personAccount(rows.find((r) => r.key === e.rowKey)?.label ?? '')
    if (p) personCounts.set(personKey(p.name), (personCounts.get(personKey(p.name)) ?? 0) + 1)
  }
  const byPerson = [...personCounts.values()].some((n) => n >= 2)
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
    const { entries, status, used } = usedFor(row.meaning)
    const resolved = resolveMeaning(comparison, used, row.meaning)
    const loanRow = row.meaning === 'loan_receivable' || row.meaning === 'loan_payable'
    const cells = comparison.columns.map((_, i): HeadlineCell => {
      const h = held(i)
      if (h) return h
      // A stored loan line on the wrong side for its sign and section: no figure on either loan row
      // until staff move it (never moved silently, 27 Nov 2026).
      const conflicts = loanRow ? loanSideConflicts(comparison, loanUsed, i) : []
      if (conflicts.length > 0) return { kind: 'blank', conflict: true, why: `${conflicts.map((c) => c.message).join(' ')} Move it on the Outcome prediction page.` }
      if (loanRow && byPerson) {
        const sides = loanSidesAt(comparison, loanUsed, i)
        const side = row.meaning === 'loan_receivable' ? sides.to : sides.by
        if (!side || (side.lines.length === 0 && resolved.years[i]?.value === null)) return { kind: 'blank', why: null }
        return { kind: 'value', value: side.amount, lines: side.lines }
      }
      const year = resolved.years[i]
      if (status === 'not_found' || !year || year.value === null) return { kind: 'blank', why: null }
      const note =
        row.meaning === 'total_current_assets'
          ? overdrawnBankNote(comparison, i)
          : row.meaning === 'income_tax_payable' && year.lines.some((l) => l.printed < 0)
            ? NEGATIVE_LIABILITY_NOTE
            : null
      return { kind: 'value', value: year.value, lines: year.lines, ...(note ? { note } : {}) }
    })
    return { key: row.meaning, label: row.label, meaning: row.meaning, status, notPrinted: status === 'confirmed' && resolved.status === 'none', entries, cells }
  })
}

const BANK_WORDS = /\b(bank|cheque|savings|transaction|operating) (account|acc)\b|\bbank\b|\bcash at bank\b/i
const BANK_SECTION = /^(bank|bank accounts|cash|cash at bank|cash (and|&) cash equivalents)$/i

/**
 * A year's current assets that include an overdrawn bank account (a negative balance printed among the
 * current assets, MBM FY2024 (47,964)): said beside the printed total, which is shown as printed (Gabby,
 * 18 Nov 2026). A line is a bank account when its words say so, or when the same account is printed under
 * a "Bank" or "Cash" section in another year.
 */
export function overdrawnBankNote(comparison: PrintedComparison, i: number): string | null {
  const bs = comparison.tables.find((t) => t.kind === 'balance_sheet')?.rows ?? []
  const bankLabels = new Set(bs.filter((r) => r.path.some((p) => BANK_SECTION.test(p.trim()))).map((r) => r.label.trim().toLowerCase()))
  const overdrawn = bs.filter((r) => {
    const v = r.cells[i]?.value
    if (r.style !== 'line' || !r.cells[i]?.printed || typeof v !== 'number' || v >= 0) return false
    if (!r.path.some((p) => /^current assets$/i.test(p.trim()))) return false
    return BANK_WORDS.test(r.label) || bankLabels.has(r.label.trim().toLowerCase())
  })
  if (overdrawn.length === 0) return null
  const amounts = overdrawn.map((r) => `−$${Math.abs(r.cells[i].value as number).toLocaleString('en-AU', { maximumFractionDigits: 2 })}`)
  return overdrawn.length === 1
    ? `As printed: current assets include an overdrawn bank account (${amounts[0]})`
    : `As printed: current assets include overdrawn bank accounts (${amounts.join(', ')})`
}

const csvCell = (value: string): string => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value)
const csvRow = (...cells: string[]) => cells.map(csvCell).join(',')

/** The page's CSV: the headline figures only, as shown (a suggested line marked). */
export function headlineCsv(input: { clientName: string; comparison: PrintedComparison; rows: HeadlineRow[] }): string {
  const heads = input.comparison.columns.map(columnTitle)
  const lines = [
    csvRow('Financial statements — headline figures', input.clientName),
    csvRow('Generated', dateTimeText(new Date())),
    '',
    csvRow('Figure', ...heads.map((h) => `${h.title} (${h.period})`), 'Note'),
  ]
  for (const r of input.rows) {
    const note = r.status === 'suggested' ? 'Suggested line, not confirmed yet' : r.status === 'not_found' ? 'No printed line matched' : r.notPrinted ? 'Not printed' : ''
    lines.push(
      csvRow(
        r.label,
        ...r.cells.map((c) => (c.kind === 'value' ? formatPrinted(c.value) : c.kind === 'ica' ? audBalance(Math.round(c.cell.value * 100)) : c.kind === 'held' ? BEING_PREPARED : c.kind === 'blank' && c.conflict ? 'Move needed' : '')),
        note,
      ),
    )
  }
  const proofs = comparisonProof(input.comparison)
  lines.push(
    '',
    csvRow('Checks', ...proofs.map(proofCsv), ''),
    csvRow('Source', ...input.comparison.columns.map((_, i) => periodSourceCsv(input.comparison.periodSources?.[i])), ''),
  )
  return lines.join('\r\n')
}

/** A period's badges, or why it is not proven, for a CSV cell. */
function proofCsv(p: ReturnType<typeof comparisonProof>[number]): string {
  if (p.status === 'held') return `${BEING_PREPARED}: ${p.reasons.join('; ')}`
  return [...p.badges.map((b) => `✓ ${b}`), ...p.notes.map((n) => `⚠ ${n}`)].join('; ')
}

/** The CSV of the "Cards" view: one block per figure, its printed lines, then every year. */
export function headlineCardsCsv(input: { clientName: string; comparison: PrintedComparison; rows: HeadlineRow[] }): string {
  const heads = input.comparison.columns.map(columnTitle)
  const lines = [csvRow('Financial statements — headline figures', input.clientName), csvRow('Generated', dateTimeText(new Date()))]
  for (const r of input.rows) {
    const printed = [...new Set(r.cells.flatMap((c) => (c.kind === 'value' ? c.lines.map((l) => l.label.trim()) : [])))]
    const state = r.status === 'suggested' ? 'Suggested line, not confirmed yet' : r.status === 'not_found' ? 'No printed line matched' : r.notPrinted ? 'Not printed' : ''
    lines.push('', csvRow(r.label.toUpperCase(), r.meaning ? (printed.length ? `From ${printed.map((l) => `“${l}”`).join(', ')}` : '') : "The ATO's own balance at each period's end (verified ATO account)", state))
    r.cells.forEach((c, i) => {
      const value = c.kind === 'value' ? formatPrinted(c.value) : c.kind === 'ica' ? audBalance(Math.round(c.cell.value * 100)) : c.kind === 'held' ? BEING_PREPARED : c.kind === 'blank' && c.conflict ? 'Move needed' : ''
      lines.push(csvRow(`${heads[i].title} (${heads[i].period})`, value, c.kind === 'value' && c.note ? c.note : ''))
    })
  }
  const proofs = comparisonProof(input.comparison)
  lines.push('', csvRow('PERIODS', 'Checks', 'Source'))
  input.comparison.columns.forEach((_, i) => {
    lines.push(csvRow(`${heads[i].title} (${heads[i].period})`, proofs[i] ? proofCsv(proofs[i]) : '', periodSourceCsv(input.comparison.periodSources?.[i])))
  })
  return lines.join('\r\n')
}
