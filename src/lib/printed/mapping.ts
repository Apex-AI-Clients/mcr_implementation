import type { ComparisonColumn, ComparisonRow, PrintedComparison } from './compare'
import { MEANINGS, type Meaning } from './meanings'

/**
 * A client's confirmed mapping (migration 0034) applied to the as-printed
 * comparison. Pure. A meaning's figure for a year is its mapped printed
 * line, or the mapped lines added up (GST + PAYG + BAS Payable), each shown.
 * A meaning with no confirmed line is "not identified": no figure, no guess.
 */

export interface MappingEntry {
  meaning: Meaning
  /** The comparison row key; '' with nonePrinted. */
  rowKey: string
  label: string | null
  nonePrinted: boolean
  confirmedBy: string
  confirmedAt: string
}

export interface MappedLine {
  label: string
  value: number
}

export interface MeaningYear {
  column: ComparisonColumn
  /** Null: none of the mapped lines is printed for this year. */
  value: number | null
  lines: MappedLine[]
}

export interface ResolvedMeaning {
  meaning: Meaning
  /** 'mapped': lines confirmed. 'none': staff confirmed the statements print no such line. 'not_identified': nothing confirmed. */
  status: 'mapped' | 'none' | 'not_identified'
  years: MeaningYear[]
  /** Mapped lines the comparison no longer prints (a re-read changed them). */
  missing: string[]
}

export function resolveMeaning(comparison: PrintedComparison, mapping: MappingEntry[], meaning: Meaning): ResolvedMeaning {
  const entries = mapping.filter((m) => m.meaning === meaning)
  const status = entries.length === 0 ? 'not_identified' : entries.every((e) => e.nonePrinted) ? 'none' : 'mapped'
  const rows = comparison.tables.flatMap((t) => t.rows)
  const mapped: ComparisonRow[] = []
  const missing: string[] = []
  for (const e of entries.filter((x) => !x.nonePrinted)) {
    const row = rows.find((r) => r.key === e.rowKey)
    if (row) mapped.push(row)
    else missing.push(e.label ?? e.rowKey)
  }
  const years = comparison.columns.map((column, i) => {
    const lines = mapped.flatMap((r) => {
      const cell = r.cells[i]
      return cell.printed && typeof cell.value === 'number' ? [{ label: r.label, value: cell.value }] : []
    })
    return { column, value: lines.length ? lines.reduce((s, l) => s + l.value, 0) : null, lines }
  })
  return { meaning, status, years, missing }
}

export function resolveAll(comparison: PrintedComparison, mapping: MappingEntry[]): ResolvedMeaning[] {
  return MEANINGS.map((m) => resolveMeaning(comparison, mapping, m.key))
}

/** Every meaning confirmed: mapped to lines, or confirmed as not printed. */
export function mappingConfirmed(mapping: MappingEntry[]): boolean {
  return MEANINGS.every((m) => mapping.some((e) => e.meaning === m.key))
}

// ─── The SBR prediction's financial inputs ────────────────────────────────────

export interface MappedFigure {
  amount: number
  /** "FY2025 balance sheet" or "current period at 30 Sep 2026". */
  source: string
  asOf: string
  lines: MappedLine[]
}

export interface PredictionFinancials {
  confirmed: boolean
  /** The latest balance sheet column: the current period when there is one. */
  balanceSheet: { column: ComparisonColumn; label: string } | null
  /** Owed to the company by a director or related party; 0 when confirmed as not printed. Null: not identified. */
  loanReceivable: MappedFigure | null
  /** The ATO-related lines (not income tax, not super), added up. Null: not identified or not printed. */
  atoDebt: MappedFigure | null
  creditCards: MappedFigure | null
  cashLoans: MappedFigure | null
  bankOverdraft: MappedFigure | null
  tradeSuppliers: MappedFigure | null
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const dayLabel = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return `${d} ${MONTHS[m - 1]} ${y}`
}

export function columnSourceLabel(c: ComparisonColumn): string {
  return c.kind === 'annual' ? `${c.key} balance sheet` : `current period at ${dayLabel(c.periodEnd)}`
}

export function predictionFinancials(comparison: PrintedComparison, mapping: MappingEntry[]): PredictionFinancials {
  const bsTable = comparison.tables.find((t) => t.kind === 'balance_sheet')
  // The latest column the balance sheet prints anything in.
  const index = bsTable ? [...comparison.columns.keys()].reverse().find((i) => bsTable.rows.some((r) => r.cells[i].printed)) : undefined
  const column = index === undefined ? null : comparison.columns[index]
  const figure = (meaning: Meaning, { absolute = false, noneIsZero = false } = {}): MappedFigure | null => {
    if (!column || index === undefined) return null
    const r = resolveMeaning(comparison, mapping, meaning)
    const base = { source: columnSourceLabel(column), asOf: column.periodEnd }
    if (r.status === 'none' && noneIsZero) return { ...base, amount: 0, lines: [] }
    const year = r.years[index]
    if (r.status !== 'mapped' || year.value === null) return null
    return { ...base, amount: absolute ? Math.abs(year.value) : year.value, lines: year.lines }
  }
  return {
    confirmed: mappingConfirmed(mapping),
    balanceSheet: column ? { column, label: columnSourceLabel(column) } : null,
    loanReceivable: figure('loan_receivable', { noneIsZero: true }),
    atoDebt: figure('ato_debt'),
    creditCards: figure('credit_cards', { absolute: true }),
    cashLoans: figure('cash_loans', { absolute: true }),
    bankOverdraft: figure('bank_overdraft', { absolute: true }),
    tradeSuppliers: figure('trade_suppliers', { absolute: true }),
  }
}
