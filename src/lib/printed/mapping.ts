import type { CellSource, ComparisonColumn, ComparisonRow, PrintedComparison } from './compare'
import { KEY_FIGURES, MEANINGS, type Meaning } from './meanings'
import { suggestMapping } from './dictionary'
import { SUBTRACTED } from './verify'

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
  /** The amount as the meaning counts it (loan accounts: owed to / by the company, positive). */
  value: number
  /** The amount exactly as printed, sign included. */
  printed: number
  /** Where it is printed: document, page, the printed line. */
  source: CellSource | null
  /** The reading rule applied to the printed amount, in plain English; null when it is taken as printed. */
  rule: string | null
}

const LOAN_MEANINGS: Meaning[] = ['loan_receivable', 'loan_payable']
const underLiabilities = (row: ComparisonRow) => /liabilit/i.test(row.path.join(' '))

/**
 * A loan account line's amount as the meaning counts it (ported from the old
 * reader's loan rule). The same director loan is printed on either side of a
 * balance sheet, and its sign says which way the money is owed:
 *
 *   owed TO the company   under assets: as printed; under liabilities: the
 *                         printed figure negated — a NEGATIVE liability is
 *                         money the director owes the company
 *   owed BY the company   under liabilities: as printed; under assets: negated
 *
 * Every other meaning is taken as printed.
 */
export function readLoanLine(row: ComparisonRow, meaning: Meaning, printed: number): { value: number; rule: string | null } {
  // "Less Unexpired Interest" printed positive is taken off, as its printed total does (verify.ts).
  if (SUBTRACTED(row.label) && printed > 0) {
    return { value: -printed, rule: `"${row.label.trim()}" is printed as a positive figure that the statement subtracts, so it is taken off.` }
  }
  if (!LOAN_MEANINGS.includes(meaning)) return { value: printed, rule: null }
  const liability = underLiabilities(row)
  const flip = meaning === 'loan_receivable' ? liability : !liability
  if (!flip) return { value: printed, rule: null }
  return {
    value: printed === 0 ? 0 : -printed,
    rule:
      meaning === 'loan_receivable'
        ? printed < 0
          ? 'A negative figure under liabilities means the director (or related party) owes the company.'
          : 'A positive figure under liabilities is owed BY the company, so it counts against money owed to the company.'
        : printed < 0
          ? 'A negative figure under assets means the company owes the director (or related party).'
          : 'A positive figure under assets is owed TO the company, so it counts against money owed by the company.',
  }
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
    const lines = mapped.flatMap((r): MappedLine[] => {
      const cell = r.cells[i]
      if (!cell.printed || typeof cell.value !== 'number') return []
      const read = readLoanLine(r, meaning, cell.value)
      return [{ label: r.label, value: read.value, printed: cell.value, source: cell.source, rule: read.rule }]
    })
    return { column, value: lines.length ? lines.reduce((s, l) => s + l.value, 0) : null, lines }
  })
  return { meaning, status, years, missing }
}

export function resolveAll(comparison: PrintedComparison, mapping: MappingEntry[]): ResolvedMeaning[] {
  return MEANINGS.map((m) => resolveMeaning(comparison, mapping, m.key))
}

/** The seven key figures confirmed: mapped to lines, or confirmed as not printed. */
export function mappingConfirmed(mapping: MappingEntry[]): boolean {
  return KEY_FIGURES.every((m) => mapping.some((e) => e.meaning === m.key))
}

// ─── The SBR prediction's financial inputs ────────────────────────────────────

export interface MappedFigure {
  amount: number
  /** "FY2025 balance sheet" or "current period at 30 Sep 2026". */
  source: string
  asOf: string
  lines: MappedLine[]
}

/**
 * An input the statements cannot give yet: no line is confirmed for it, a
 * confirmed line is not printed on the latest balance sheet, or the latest
 * balance sheet prints a line that looks like it (a director or related-party
 * loan, an ATO account) that is not mapped to anything. Never shown as $0.
 */
export interface NotIdentified {
  /** "Not found in the statements — choose the line". */
  message: string
  /** Printed lines that look like it and are not mapped, as printed. */
  candidates: string[]
}

export interface PredictionFinancials {
  confirmed: boolean
  /** The latest balance sheet column: the current period when there is one. */
  balanceSheet: { column: ComparisonColumn; label: string } | null
  /** Owed to the company by a director or related party; 0 when confirmed as not printed. Null: not identified. */
  loanReceivable: MappedFigure | null
  /** Owed by the company to a director or related party (funds introduced); 0 when confirmed as not printed. */
  loanPayable: MappedFigure | null
  /** Inputs that are not identified, and why: never a silent $0. */
  notIdentified: Partial<Record<'loanReceivable' | 'atoDebt', NotIdentified>>
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

export function predictionFinancials(
  comparison: PrintedComparison,
  mapping: MappingEntry[],
  { directors = [] }: { directors?: readonly string[] } = {},
): PredictionFinancials {
  const bsTable = comparison.tables.find((t) => t.kind === 'balance_sheet')
  // The latest column the balance sheet prints anything in.
  const index = bsTable ? [...comparison.columns.keys()].reverse().find((i) => bsTable.rows.some((r) => r.cells[i].printed)) : undefined
  const column = index === undefined ? null : comparison.columns[index]
  // Mapped lines printing "-" (nil) count as $0; a mapped line not printed at all does not.
  const printedNil = (meaning: Meaning) => {
    if (index === undefined) return false
    const keys = mapping.filter((m) => m.meaning === meaning && !m.nonePrinted).map((m) => m.rowKey)
    const rows = comparison.tables.flatMap((t) => t.rows).filter((row) => keys.includes(row.key))
    return rows.length > 0 && rows.every((row) => row.cells[index].printed && row.cells[index].value === null)
  }
  const figure = (meaning: Meaning, { absolute = false, noneIsZero = false } = {}): MappedFigure | null => {
    if (!column || index === undefined) return null
    const r = resolveMeaning(comparison, mapping, meaning)
    const base = { source: columnSourceLabel(column), asOf: column.periodEnd }
    if (r.status === 'none' && noneIsZero) return { ...base, amount: 0, lines: [] }
    const year = r.years[index]
    if (r.status === 'mapped' && year.value === null && printedNil(meaning)) return { ...base, amount: 0, lines: [] }
    if (r.status !== 'mapped' || year.value === null) return null
    return { ...base, amount: absolute ? Math.abs(year.value) : year.value, lines: year.lines }
  }

  // Lines the latest balance sheet prints that look like a loan account or an
  // ATO account (dictionary.ts) and are mapped to nothing.
  const mappedKeys = new Set(mapping.filter((m) => !m.nonePrinted).map((m) => m.rowKey))
  const rows = comparison.tables.flatMap((t) => t.rows)
  const suggested = suggestMapping(comparison, { directors })
  const unmapped = (keys: string[]) =>
    keys
      .filter((k) => !mappedKeys.has(k))
      .map((k) => rows.find((row) => row.key === k))
      .filter((row): row is ComparisonRow => !!row && index !== undefined && row.cells[index].printed)
      .map((row) => row.label)
  const loanCandidates = unmapped([...suggested.loan_receivable, ...suggested.loan_payable])
  const atoCandidates = unmapped(suggested.ato_debt)

  // The loan accounts, each line on the side its printed sign says, whichever
  // of the two meanings it was confirmed under (old reader: a negative loan
  // under liabilities is a receivable, wherever the model had filed it).
  const sides = loanSides()
  function loanSides(): { to: MappedFigure | null; by: MappedFigure | null } {
    if (!column || index === undefined) return { to: null, by: null }
    const base = { source: columnSourceLabel(column), asOf: column.periodEnd }
    const recv = resolveMeaning(comparison, mapping, 'loan_receivable')
    const pay = resolveMeaning(comparison, mapping, 'loan_payable')
    const to: MappedLine[] = []
    const by: MappedLine[] = []
    const moved = (l: MappedLine, toCompany: boolean): MappedLine => ({
      ...l,
      value: -l.value,
      rule: `${l.printed < 0 ? 'Printed negative' : 'Printed positive'}, so it is owed ${toCompany ? 'TO' : 'BY'} the company, although it is confirmed as owed ${toCompany ? 'by' : 'to'} it.`,
    })
    for (const l of recv.years[index].lines) (l.value >= 0 ? to : by).push(l.value >= 0 ? l : moved(l, false))
    for (const l of pay.years[index].lines) (l.value >= 0 ? by : to).push(l.value >= 0 ? l : moved(l, true))
    const sum = (lines: MappedLine[]) => Math.round(lines.reduce((t, l) => t + l.value, 0) * 100) / 100
    const side = (lines: MappedLine[], r: ResolvedMeaning, meaning: Meaning): MappedFigure | null => {
      if (lines.length > 0) return { ...base, amount: sum(lines), lines }
      // Nothing on this side: $0 only when staff confirmed none is printed, or its lines print "-".
      if (r.status === 'none' || (r.status === 'mapped' && printedNil(meaning))) return { ...base, amount: 0, lines: [] }
      // Its mapped lines are printed but all on the other side.
      if (r.status === 'mapped' && r.years[index].lines.length > 0) return { ...base, amount: 0, lines: [] }
      return null
    }
    return { to: side(to, recv, 'loan_receivable'), by: side(by, pay, 'loan_payable') }
  }

  const loanReceivable = sides.to
  const atoDebt = figure('ato_debt')
  const notIdentified: PredictionFinancials['notIdentified'] = {}
  if (column && (loanReceivable === null || loanCandidates.length > 0)) {
    notIdentified.loanReceivable = {
      message:
        loanCandidates.length > 0
          ? `Not identified — the ${columnSourceLabel(column)} prints ${loanCandidates.map((l) => `“${l}”`).join(', ')}, not mapped to a loan account. Choose the line.`
          : 'Not found in the statements — choose the line.',
      candidates: loanCandidates,
    }
  }
  if (!column) {
    notIdentified.loanReceivable = { message: 'No balance sheet has been read yet — upload the financial statements, then choose the line.', candidates: [] }
  }
  if (column && atoCandidates.length > 0) {
    notIdentified.atoDebt = {
      message: `Not identified — the ${columnSourceLabel(column)} prints ${atoCandidates.map((l) => `“${l}”`).join(', ')}, not mapped to ATO-related debt. Choose the line.`,
      candidates: atoCandidates,
    }
  }

  return {
    confirmed: mappingConfirmed(mapping),
    balanceSheet: column ? { column, label: columnSourceLabel(column) } : null,
    loanReceivable: notIdentified.loanReceivable ? null : loanReceivable,
    loanPayable: sides.by,
    notIdentified,
    atoDebt,
    creditCards: figure('credit_cards', { absolute: true }),
    cashLoans: figure('cash_loans', { absolute: true }),
    bankOverdraft: figure('bank_overdraft', { absolute: true }),
    tradeSuppliers: figure('trade_suppliers', { absolute: true }),
  }
}
