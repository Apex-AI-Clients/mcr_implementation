import type { CellSource, ComparisonColumn, ComparisonRow, PrintedComparison } from './compare'
import { KEY_FIGURES, MEANING, MEANINGS, type Meaning } from './meanings'
import { DRAWINGS_HINT, lineRank, namesDirector, personAccount, personKey, suggestMapping, type RelatedNames } from './dictionary'
import { SUBTRACTED } from './verify'
import { comparisonProof, heldMessage } from './proof'
import { dateText } from '@/lib/dates'

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
  /** Set when auto-selected (autoMapping.ts): the rule used, in plain English. Null or absent: staff chose it. */
  autoRule?: string | null
  /**
   * Set when a staff answer given under an older reader was switched to the
   * lines the current reader matches: "Updated after a reading fix (was: …)".
   */
  updatedNote?: string | null
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
  /** One person's account (groupPersons): the person's own printed lines it adds up. */
  parts?: MappedLine[]
}

const LOAN_MEANINGS: Meaning[] = ['loan_receivable', 'loan_payable']

/** The balance sheet's credit side: liabilities, or equity (Gabby, 24 Nov 2026), never an asset section. */
const EQUITY_SECTION = /\bequity\b|\bcapital\b|\bowners?'?s?'? funds\b|\bshareholders?'?s?'? funds\b|\bmembers?'? funds\b|\btrust funds\b|\bproprietorship\b|\breserves\b/i
export function onCreditSide(row: ComparisonRow): boolean {
  const path = row.path.join(' › ')
  if (/liabilit/i.test(path)) return true
  return EQUITY_SECTION.test(path) && !/\basset/i.test(path)
}

/** The section a line is printed under, as printed ("Equity", "Non-current Liabilities"). */
const sectionName = (row: ComparisonRow) => row.path.filter((p) => p.trim() !== '').at(-1)?.trim() || (onCreditSide(row) ? 'Liabilities' : 'Assets')

/**
 * A loan account line's amount as the meaning counts it: ONE sign-aware section rule, the same on
 * the page, in the exports and in the prediction (Gabby, 24 Nov 2026; the user, 26 Nov 2026):
 *
 *   ASSETS, positive                    → Director loan account (Debit): owed TO the company
 *   LIABILITIES or EQUITY, positive     → Loan account director (Credit): owed BY the company
 *   LIABILITIES or EQUITY, NEGATIVE     → Debit: a debit balance, owed to the company
 *   ASSETS, negative                    → Credit: a credit balance, owed by the company
 *
 * The meaning a line was confirmed under says which side it is read for; a line whose sign puts it
 * on the other side counts against this one (loanSidesAt moves it across). Every other meaning is
 * taken as printed.
 */
export function readLoanLine(row: ComparisonRow, meaning: Meaning, printed: number): { value: number; rule: string | null } {
  // "Less Unexpired Interest" printed positive is taken off, as its printed total does (verify.ts).
  if (SUBTRACTED(row.label) && printed > 0) {
    return { value: -printed, rule: `"${row.label.trim()}" is printed as a positive figure that the statement subtracts, so it is taken off.` }
  }
  if (!LOAN_MEANINGS.includes(meaning)) return { value: printed, rule: null }
  const credit = onCreditSide(row)
  const flip = meaning === 'loan_receivable' ? credit : !credit
  if (!flip) return { value: printed, rule: null }
  const section = sectionName(row)
  return {
    value: printed === 0 ? 0 : -printed,
    rule:
      printed < 0
        ? credit
          ? `Printed as a negative amount under ${section}: a debit balance, owed to the company.`
          : `Printed as a negative amount under ${section}: a credit balance, owed by the company.`
        : credit
          ? `Printed as a positive amount under ${section}: owed by the company (Loan account director, Credit).`
          : `Printed as a positive amount under ${section}: owed to the company (Director loan account, Debit).`,
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
  // A single-line meaning mapped per document (dictionary.ts, bestPerDocument) can have a line for each
  // year's layout: in a year that prints more than one of them, only the best-ranked counts, never the sum.
  const single = !MEANING[meaning].multiple
  const rank = (r: ComparisonRow) => lineRank(meaning, r.label)
  // Asset section totals proven to add up together ("Total Bank" and "Total Current Assets",
  // dictionary.ts assetSectionTotals): counted together, never one of them alone.
  const addedUp = new Set(entries.filter((e) => /^From “.*”, added up:/.test(e.autoRule ?? '')).map((e) => e.rowKey))
  const years = comparison.columns.map((column, i) => {
    const printedRows = mapped.filter((r) => r.cells[i].printed && typeof r.cells[i].value === 'number')
    const sections = printedRows.filter((r) => addedUp.has(r.key))
    const counted = single && sections.length > 1 ? sections : single && printedRows.length > 1 ? [printedRows.reduce((best, r) => (rank(r) < rank(best) ? r : best))] : printedRows
    const lines = counted.map((r): MappedLine => {
      const cell = r.cells[i]
      const read = readLoanLine(r, meaning, cell.value as number)
      const autoRule = entries.find((e) => e.rowKey === r.key)?.autoRule ?? null
      // A section total used as a total (dictionary.ts, assetSectionTotals): its ⓘ says how it is proven.
      const rule = read.rule ?? (autoRule && autoRule.startsWith('From “') ? autoRule : null)
      return { label: r.label, value: read.value, printed: cell.value as number, source: cell.source, rule }
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
  /** Why it is what it is, when the lines alone do not say ("Not printed on the FY2026 balance sheet; …"). */
  note?: string
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
  /** "No line is confirmed for money owed to the company …". */
  message: string
  /** Printed lines that look like it and are not mapped, as printed. */
  candidates: string[]
  /** The same lines with what staff need to answer "Use it?" or "Not a loan account" (director loan only). */
  possible?: PossibleLoanLine[]
  /** The lines already confirmed for it: "Use it" adds the possible line to these. */
  confirmedRowKeys?: string[]
  /** Stored loan lines the sign-aware section rule puts on the other side: staff move them (never silently). */
  conflicts?: LoanSideConflict[]
}

/**
 * A stored loan choice (staff, rule or AI) that contradicts the ONE sign-aware section rule
 * (readLoanLine; Gabby, 24 Nov 2026): e.g. "Owner A Drawings 44,952.22", printed positive under
 * Equity, stored on the Director loan account (Debit). Flagged to staff, never applied silently
 * (the user, 27 Nov 2026): until staff move it, the prediction waits.
 */
export interface LoanSideConflict {
  rowKey: string
  label: string
  /** As printed in the latest balance sheet column. */
  printed: number
  /** The meaning it is stored under, and the one the rule puts it on. */
  storedAs: 'loan_receivable' | 'loan_payable'
  belongsTo: 'loan_receivable' | 'loan_payable'
  /** Who chose it: a staff member, or 'auto' (the rules or the AI). */
  chosenBy: string
  message: string
}

/** Every stored loan line on the wrong side for its sign and section, in the given balance sheet column. */
export function loanSideConflicts(comparison: PrintedComparison, mapping: MappingEntry[], index: number | undefined): LoanSideConflict[] {
  if (index === undefined) return []
  const rows = new Map(comparison.tables.filter((t) => t.kind === 'balance_sheet').flatMap((t) => t.rows.map((r) => [r.key, r] as const)))
  const loans = mapping.filter((e) => !e.nonePrinted && LOAN_MEANINGS.includes(e.meaning))
  // One account per person (groupPersons; Gabby, 25 Nov 2026): a person's own lines are netted, and the
  // net decides the side, never one line's sign. Such lines are never a conflict.
  const perPerson = new Map<string, number>()
  for (const e of loans) {
    const p = personAccount(rows.get(e.rowKey)?.label ?? '')
    if (p) perPerson.set(personKey(p.name), (perPerson.get(personKey(p.name)) ?? 0) + 1)
  }
  const out: LoanSideConflict[] = []
  for (const e of loans) {
    const row = rows.get(e.rowKey)
    const cell = row?.cells[index]
    if (!row || !cell?.printed || typeof cell.value !== 'number' || cell.value === 0) continue
    const person = personAccount(row.label)
    if (person && (perPerson.get(personKey(person.name)) ?? 0) >= 2) continue
    const printed = cell.value
    const credit = onCreditSide(row)
    const belongsTo = (credit ? printed < 0 : printed > 0) ? 'loan_receivable' : 'loan_payable'
    if (belongsTo === e.meaning) continue
    const section = sectionName(row)
    const how = printed < 0 ? `printed as a negative amount under ${section}` : `printed under ${section}`
    out.push({
      rowKey: row.key,
      label: row.label.trim() || '(no label)',
      printed,
      storedAs: e.meaning as LoanSideConflict['storedAs'],
      belongsTo,
      chosenBy: e.confirmedBy,
      message: `“${row.label.trim()}” is ${how}, so it belongs to ${MEANING[belongsTo].label}, not ${MEANING[e.meaning].label} — move it?`,
    })
  }
  return out
}

/** A line on the latest balance sheet that may be the director loan account (Debit): staff decide. */
export interface PossibleLoanLine {
  rowKey: string
  label: string
  /** As printed in the latest column. */
  value: number | null
  hint: string
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

const dayLabel = (iso: string) => dateText(iso)

export function columnSourceLabel(c: ComparisonColumn): string {
  return c.kind === 'annual' ? `${c.key} balance sheet` : `current period at ${dayLabel(c.periodEnd)}`
}

/** For staff, beside a figure: "FY2025 balance sheet", "Current period to 30 Oct 2026" (never "FY2027" for a part-year). */
export function balanceSheetLabel(c: ComparisonColumn): string {
  return c.kind === 'annual' ? `FY${c.financialYear} balance sheet` : `Current period to ${dayLabel(c.periodEnd)}`
}

/** Mapped lines all printing "-" (nil) in this column count as $0; a mapped line not printed at all does not. */
function printedNilAt(comparison: PrintedComparison, mapping: MappingEntry[], meaning: Meaning, index: number): boolean {
  const keys = mapping.filter((m) => m.meaning === meaning && !m.nonePrinted).map((m) => m.rowKey)
  const rows = comparison.tables.flatMap((t) => t.rows).filter((row) => keys.includes(row.key))
  return rows.length > 0 && rows.every((row) => row.cells[index].printed && row.cells[index].value === null)
}

const money2 = (v: number) => `${v < 0 ? '−' : ''}$${Math.abs(v).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/**
 * One account per person (Gabby, 25 Nov 2026): a name printed with two or more of its own account
 * lines ("Matthew Trow - Drawings", "- Share of Profit", "- Capital Introduced") is one director loan
 * account, its lines added up. Netted within the person, never across people: a person owing the
 * company is on the Debit side (owed TO), one the company owes on the Credit side (owed BY); a person
 * netting to nil stays on the Debit side at $0, so the ⓘ still lists them. The person's line carries
 * its own lines (`parts`). In place, on the two sides as loanSidesAt sorted them (values positive).
 */
export function groupPersons(to: MappedLine[], by: MappedLine[]): void {
  const groups = new Map<string, { name: string; to: MappedLine[]; by: MappedLine[] }>()
  for (const [side, lines] of [['to', to], ['by', by]] as const) {
    for (const l of lines) {
      const p = personAccount(l.label)
      if (!p) continue
      const g = groups.get(personKey(p.name)) ?? { name: p.name, to: [], by: [] }
      g[side].push(l)
      groups.set(personKey(p.name), g)
    }
  }
  for (const g of groups.values()) {
    const parts = [...g.to, ...g.by]
    if (parts.length < 2) continue
    for (const l of parts) {
      const list = g.to.includes(l) ? to : by
      list.splice(list.indexOf(l), 1)
    }
    const owedTo = Math.round((g.to.reduce((s, l) => s + l.value, 0) - g.by.reduce((s, l) => s + l.value, 0)) * 100) / 100
    const printed = Math.round(parts.reduce((s, l) => s + l.printed, 0) * 100) / 100
    const way = owedTo > 0 ? `owes the company ${money2(owedTo)}` : owedTo < 0 ? `is owed ${money2(-owedTo)} by the company` : 'nets to nil'
    const line: MappedLine = {
      label: g.name,
      value: Math.abs(owedTo),
      printed,
      source: parts[0].source,
      rule: `One account per person: ${parts.map((l) => `“${l.label.trim()}” ${money2(l.printed)}`).join(' + ')} = ${money2(printed)} as printed, so ${g.name} ${way}.`,
      parts,
    }
    ;(owedTo >= 0 ? to : by).push(line)
  }
}

/**
 * The loan accounts in one balance sheet column, each line on the side its
 * printed sign says, whichever of the two meanings it was confirmed under
 * (old reader: a negative loan under liabilities is a receivable, wherever the
 * model had filed it); a person's own lines netted into one account
 * (groupPersons). Null on a side: not identified for that column.
 */
export function loanSidesAt(comparison: PrintedComparison, mapping: MappingEntry[], index: number): { to: MappedFigure | null; by: MappedFigure | null } {
  const column = comparison.columns[index]
  const base = { source: columnSourceLabel(column), asOf: column.periodEnd }
  const recv = resolveMeaning(comparison, mapping, 'loan_receivable')
  const pay = resolveMeaning(comparison, mapping, 'loan_payable')
  const to: MappedLine[] = []
  const by: MappedLine[] = []
  const moved = (l: MappedLine, toCompany: boolean): MappedLine => ({
    ...l,
    value: -l.value,
    // The section-and-sign rule (readLoanLine) says which side it is on; this is only the fallback.
    rule: l.rule ?? `${l.printed < 0 ? 'Printed negative' : 'Printed positive'}, so it is owed ${toCompany ? 'TO' : 'BY'} the company, although it is confirmed as owed ${toCompany ? 'by' : 'to'} it.`,
  })
  for (const l of recv.years[index].lines) (l.value >= 0 ? to : by).push(l.value >= 0 ? l : moved(l, false))
  for (const l of pay.years[index].lines) (l.value >= 0 ? by : to).push(l.value >= 0 ? l : moved(l, true))
  groupPersons(to, by)
  const sum = (lines: MappedLine[]) => Math.round(lines.reduce((t, l) => t + l.value, 0) * 100) / 100
  const side = (lines: MappedLine[], r: ResolvedMeaning, meaning: Meaning): MappedFigure | null => {
    if (lines.length > 0) return { ...base, amount: sum(lines), lines }
    // Nothing on this side: $0 only when staff confirmed none is printed, or its lines print "-".
    if (r.status === 'none' || (r.status === 'mapped' && printedNilAt(comparison, mapping, meaning, index))) return { ...base, amount: 0, lines: [] }
    // Its mapped lines are printed but all on the other side.
    if (r.status === 'mapped' && r.years[index].lines.length > 0) return { ...base, amount: 0, lines: [] }
    return null
  }
  return { to: side(to, recv, 'loan_receivable'), by: side(by, pay, 'loan_payable') }
}

/** Columns the balance sheet prints anything in, oldest first: the years a loan can be read for. */
export function balanceSheetColumns(comparison: PrintedComparison): number[] {
  const bsTable = comparison.tables.find((t) => t.kind === 'balance_sheet')
  if (!bsTable) return []
  return [...comparison.columns.keys()].filter((i) => bsTable.rows.some((r) => r.cells[i].printed))
}

export interface LoanYear {
  column: ComparisonColumn
  /** "FY2025 balance sheet", "Current period to 30 Oct 2026". */
  label: string
  /** Owed to the company (gross); null: not identified for that year. */
  owedTo: number | null
  /** Owed by the company; null: not identified for that year. */
  owedBy: number | null
}

/**
 * The director (related-party) loan accounts for every balance sheet on file,
 * oldest first, by the same rules as the prediction's (which uses only the
 * latest). For staff, beside the prediction's figure: context, not an input.
 */
export function loanHistory(comparison: PrintedComparison, mapping: MappingEntry[]): LoanYear[] {
  return balanceSheetColumns(comparison).map((i) => {
    const { to, by } = loanSidesAt(comparison, mapping, i)
    const column = comparison.columns[i]
    return { column, label: balanceSheetLabel(column), owedTo: to?.amount ?? null, owedBy: by?.amount ?? null }
  })
}

/**
 * Lines staff said are not this meaning ("Not a loan account", migration 0062), as `${meaning}|${rowKey}`.
 * They are never offered again for it.
 */
export type DismissedLines = ReadonlySet<string>

/** Words of a director or related-party loan account, and drawings (Gabby, 18 Nov 2026). */
const LOAN_LIKE = /\b(loans?|directors?|shareholders?|related|associates?|associated|beneficiar(y|ies)|drawings?)\b/i
const BANK_FINANCE = /\b(hire purchase|chattel|mortgage|equipment finance|unexpired interest|lease)\b/i
const DRAWINGS_LINE = /\bdrawings?\b/i

export function predictionFinancials(
  comparison: PrintedComparison,
  mapping: MappingEntry[],
  names: RelatedNames = {},
  dismissed: DismissedLines = new Set(),
): PredictionFinancials {
  // The latest column the balance sheet prints anything in.
  const index = balanceSheetColumns(comparison).pop()
  const column = index === undefined ? null : comparison.columns[index]
  // Only a proven year is used (proof.ts): an uncertain scan reading waits, "Being prepared".
  if (column && index !== undefined && comparisonProof(comparison)[index]?.status === 'held') {
    const message = heldMessage(balanceSheetLabel(column).replace(/^Current period to/, 'current period to'))
    return {
      confirmed: mappingConfirmed(mapping),
      balanceSheet: { column, label: columnSourceLabel(column) },
      loanReceivable: null,
      loanPayable: null,
      notIdentified: { loanReceivable: { message, candidates: [] }, atoDebt: { message, candidates: [] } },
      atoDebt: null,
      creditCards: null,
      cashLoans: null,
      bankOverdraft: null,
      tradeSuppliers: null,
    }
  }
  const printedNil = (meaning: Meaning) => index !== undefined && printedNilAt(comparison, mapping, meaning, index)
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
  const suggested = suggestMapping(comparison, names)
  const unmapped = (keys: string[]) =>
    keys
      .filter((k) => !mappedKeys.has(k))
      .map((k) => rows.find((row) => row.key === k))
      .filter((row): row is ComparisonRow => !!row && index !== undefined && row.cells[index].printed)
      .map((row) => row.label)
  const loanCandidates = unmapped([...suggested.loan_receivable, ...suggested.loan_payable])
  const atoCandidates = unmapped(suggested.ato_debt)

  // The loan accounts in the latest column (loanSidesAt).
  const sides = column && index !== undefined ? loanSidesAt(comparison, mapping, index) : { to: null, by: null }

  let loanReceivable = sides.to
  const atoDebt = figure('ato_debt')
  const notIdentified: PredictionFinancials['notIdentified'] = {}
  const recv = resolveMeaning(comparison, mapping, 'loan_receivable')
  const sheet = column ? balanceSheetLabel(column).replace(/^Current period to/, 'the current period to') : ''
  // Lines on the latest balance sheet that may be the director loan account (Debit): a loan, director,
  // shareholder, related, associate, beneficiary or drawings line, or one naming a director; never a line
  // mapped to anything (the Credit side included), bank finance, or one staff said is not a loan account.
  const possibleLoans: PossibleLoanLine[] =
    column && index !== undefined
      ? (comparison.tables.find((t) => t.kind === 'balance_sheet')?.rows ?? [])
          .filter((r) => r.style === 'line' && r.cells[index].printed && !mappedKeys.has(r.key) && !dismissed.has(`loan_receivable|${r.key}`))
          .filter((r) => !BANK_FINANCE.test(r.label) && (LOAN_LIKE.test(r.label) || namesDirector(r.label, names.directors ?? [])))
          // Only a line the section-and-sign rule puts on the Debit side (readLoanLine): positive under
          // assets, negative under liabilities or equity. A positive equity line ("Owner A Drawings
          // 44,952.22") is a Credit, never a Debit candidate (24 Nov 2026).
          .filter((r) => {
            const v = r.cells[index].value
            return typeof v !== 'number' || v === 0 || (onCreditSide(r) ? v < 0 : v > 0)
          })
          .map((r) => ({
            rowKey: r.key,
            label: r.label.trim(),
            value: typeof r.cells[index].value === 'number' ? (r.cells[index].value as number) : null,
            hint: DRAWINGS_LINE.test(r.label) ? DRAWINGS_HINT : `Printed under ${r.path.join(' › ') || 'the balance sheet'}`,
          }))
      : []
  const drawings = possibleLoans.filter((l) => DRAWINGS_LINE.test(l.label))
  // The confirmed lines are not on the latest balance sheet (a new layout, MBM FY2026): $0 only when the
  // year is proven and nothing on it looks like a director loan; otherwise the possible lines, and wait.
  const linesGone = column && index !== undefined && recv.status === 'mapped' && recv.years[index].lines.length === 0 && loanReceivable === null
  if (linesGone && possibleLoans.length === 0 && comparisonProof(comparison)[index!]?.status !== 'held') {
    const before = [...recv.years.slice(0, index)].reverse().find((y) => y.value !== null)
    loanReceivable = {
      source: columnSourceLabel(column!),
      asOf: column!.periodEnd,
      amount: 0,
      lines: [],
      note: `Not printed on the ${balanceSheetLabel(column!)}${before ? `; printed in the ${balanceSheetLabel(before.column)} as $${Math.round(before.value!).toLocaleString('en-AU')}` : ''}.`,
    }
  }
  const waitingOn = [...new Set([...loanCandidates, ...(linesGone ? possibleLoans.map((l) => l.label) : drawings.map((l) => l.label))])]
  const offered = possibleLoans.filter((l) => waitingOn.includes(l.label))
  if (column && (loanReceivable === null || waitingOn.length > 0)) {
    const lead = recv.status === 'mapped' && recv.years[index!]?.lines.length === 0 ? `The confirmed lines aren't on the ${sheet}.` : recv.status === 'mapped' ? `The ${sheet} also prints a line that may be money owed to the company.` : 'No line is confirmed for money owed to the company.'
    notIdentified.loanReceivable = {
      message:
        waitingOn.length > 0
          ? `${lead} The prediction uses the latest balance sheet (${sheet}), which prints ${waitingOn.map((l) => `“${l}”`).join(', ')}: use it, or say it is not a loan account.`
          : `${lead} The prediction uses the latest balance sheet (${sheet}): choose the line, or confirm none is printed.`,
      candidates: waitingOn,
      possible: offered,
      confirmedRowKeys: mapping.filter((e) => e.meaning === 'loan_receivable' && !e.nonePrinted).map((e) => e.rowKey),
    }
  }
  if (!column) {
    notIdentified.loanReceivable = { message: 'No balance sheet has been read yet — upload the financial statements, then choose the line.', candidates: [] }
  }
  // A stored loan line on the wrong side for its sign and section: never moved silently. The loan
  // inputs wait until staff move it (the user, 27 Nov 2026).
  const conflicts = loanSideConflicts(comparison, mapping, index)
  if (column && conflicts.length > 0) {
    notIdentified.loanReceivable = {
      ...(notIdentified.loanReceivable ?? { candidates: [] }),
      message: conflicts.map((c) => c.message).join(' '),
      conflicts,
    }
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
    // A conflicting line waits for staff on both sides: never counted on the side its sign says, silently.
    loanPayable: conflicts.length > 0 ? null : sides.by,
    notIdentified,
    atoDebt,
    creditCards: figure('credit_cards', { absolute: true }),
    cashLoans: figure('cash_loans', { absolute: true }),
    bankOverdraft: figure('bank_overdraft', { absolute: true }),
    tradeSuppliers: figure('trade_suppliers', { absolute: true }),
  }
}
