import { BALANCE_SHEET_SCHEMA, INCOME_STATEMENT_SCHEMA } from './schema'
import type { ExtractedFinancialStatement, StatementHalfKey, StatementLine, ValueSource, ValueTerm } from './types'

/**
 * Where each figure on the comparison came from: read from the file (and
 * which printed lines), worked out from other figures, or not listed and
 * taken as nil. Pure; shown by the info icon beside each amount.
 */

type IsSection = 'income' | 'cogs' | 'expenses'
type BsSection = 'currentAssets' | 'nonCurrentAssets' | 'currentLiabilities' | 'nonCurrentLiabilities' | 'equity'

const TOLERANCE = 1
const near = (a: number, b: number) => Math.abs(a - b) <= TOLERANCE
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const sum = (terms: ValueTerm[]) => terms.reduce((t, x) => t + x.sign * x.value, 0)

const IS_TOTAL_SECTION: Partial<Record<string, IsSection>> = {
  totalIncome: 'income',
  totalCogs: 'cogs',
  totalExpenses: 'expenses',
}

const BS_TOTAL_SECTION: Partial<Record<string, BsSection>> = {
  totalCurrentAssets: 'currentAssets',
  totalNonCurrentAssets: 'nonCurrentAssets',
  totalCurrentLiabilities: 'currentLiabilities',
  totalNonCurrentLiabilities: 'nonCurrentLiabilities',
  totalEquity: 'equity',
}

function linesOf(s: ExtractedFinancialStatement, half: StatementHalfKey): StatementLine[] {
  return (half === 'income_statement' ? s.incomeStatement.lines : s.balanceSheet.lines) ?? []
}

/** The file a half was read from; the statement's own file for a statement not merged from slots. */
function fileOf(s: ExtractedFinancialStatement, half: StatementHalfKey): string | null {
  return s.halfFilenames?.[half] ?? (s.sourceFilename || null)
}

/** Closing stock is stored positive and comes off cost of sales. */
function lineAmount(key: string, value: number): number {
  return key === 'closingStock' ? Math.abs(value) : value
}

/**
 * A line item: the printed lines mapped to it. Lines stored as a positive
 * amount (a loan printed negative under liabilities) are matched either way.
 */
function explainLine(half: StatementHalfKey, section: string, s: ExtractedFinancialStatement, key: string, value: number | null): ValueSource | null {
  if (value === null) return null
  const file = fileOf(s, half)
  const lines = linesOf(s, half).filter((l) => !l.isTotal && l.value !== null && l.canonicalKey === `${section}.${key}`)
  if (lines.length === 0) return value === 0 ? { kind: 'nil', sourceFilename: file } : { kind: 'picked', sourceFilename: file }
  const asPrinted = lines.map((l) => ({ label: l.rawLabel, value: lineAmount(key, l.value as number) }))
  const absolute = asPrinted.map((p) => ({ ...p, value: Math.abs(p.value) }))
  const total = (ps: typeof asPrinted) => ps.reduce((t, p) => t + p.value, 0)
  const printed = near(total(asPrinted), value) ? asPrinted : near(total(absolute), value) ? absolute : null
  return printed ? { kind: 'picked', sourceFilename: file, printed } : { kind: 'picked', sourceFilename: file }
}

export function explainIncomeLine(section: IsSection, s: ExtractedFinancialStatement, key: string, value: number | null): ValueSource | null {
  return explainLine('income_statement', section, s, key, value)
}

export function explainBalanceLine(section: BsSection, s: ExtractedFinancialStatement, key: string, value: number | null): ValueSource | null {
  return explainLine('balance_sheet', section, s, key, value)
}

/** Every non-nil figure of a section, with its label. */
function sectionTerms(labels: Record<string, string>, figures: Record<string, number | null | undefined>): ValueTerm[] {
  const terms: ValueTerm[] = []
  for (const [key, label] of Object.entries(labels)) {
    const v = num(figures[key])
    if (v === null || v === 0) continue
    terms.push(key === 'closingStock' ? { label, value: Math.abs(v), sign: -1 } : { label, value: v, sign: 1 })
  }
  return terms
}

function incomeTotalTerms(s: ExtractedFinancialStatement, key: string): ValueTerm[] | null {
  const t = s.incomeStatement.totals
  const L = INCOME_STATEMENT_SCHEMA.totals
  const section = IS_TOTAL_SECTION[key]
  if (section) {
    const terms = sectionTerms(INCOME_STATEMENT_SCHEMA[section], s.incomeStatement[section] as Record<string, number | null>)
    return terms.length ? terms : null
  }
  const income = num(t.totalIncome)
  const cogs = num(t.totalCogs)
  const gross = num(t.grossProfit)
  const expenses = num(t.totalExpenses)
  if (key === 'grossProfit') {
    if (income === null) return null
    return [{ label: L.totalIncome, value: income, sign: 1 }, { label: L.totalCogs, value: cogs ?? 0, sign: -1 }]
  }
  if (key === 'profitBeforeTax') {
    if (expenses === null) return null
    if (gross !== null) return [{ label: L.grossProfit, value: gross, sign: 1 }, { label: L.totalExpenses, value: expenses, sign: -1 }]
    if (income === null) return null
    return [
      { label: L.totalIncome, value: income, sign: 1 },
      ...(cogs !== null ? [{ label: L.totalCogs, value: cogs, sign: -1 as const }] : []),
      { label: L.totalExpenses, value: expenses, sign: -1 },
    ]
  }
  if (key === 'netProfitAfterTax') {
    const pbt = num(t.profitBeforeTax)
    const tax = linesOf(s, 'income_statement').find((l) => !l.isTotal && l.section === 'incomeTax' && l.value !== null && l.value !== 0)
    if (pbt === null || !tax) return null
    return [{ label: L.profitBeforeTax, value: pbt, sign: 1 }, { label: tax.rawLabel, value: Math.abs(tax.value as number), sign: -1 }]
  }
  return null
}

/** Ways a balance sheet total can be made up, tried in order. */
function balanceTotalTerms(s: ExtractedFinancialStatement, key: string): ValueTerm[][] {
  const t = s.balanceSheet.totals
  const L = BALANCE_SHEET_SCHEMA.totals
  const section = BS_TOTAL_SECTION[key]
  if (section) {
    const terms = sectionTerms(BALANCE_SHEET_SCHEMA[section], s.balanceSheet[section] as Record<string, number | null>)
    if (!terms.length) return []
    // A trust's distributions may be stored positive in equity, yet come off it.
    const distributionsOff = terms.map((x) => (section === 'equity' && x.label === BALANCE_SHEET_SCHEMA.equity.distributions ? { ...x, value: Math.abs(x.value), sign: -1 as const } : x))
    return [terms, distributionsOff]
  }
  const pair = (a: keyof typeof L, b: keyof typeof L, sign: 1 | -1): ValueTerm[][] => {
    const x = num(t[a])
    const y = num(t[b])
    return x === null || y === null ? [] : [[{ label: L[a], value: x, sign: 1 }, { label: L[b], value: y, sign }]]
  }
  if (key === 'totalAssets') return pair('totalCurrentAssets', 'totalNonCurrentAssets', 1)
  if (key === 'totalLiabilities') return pair('totalCurrentLiabilities', 'totalNonCurrentLiabilities', 1)
  if (key === 'netAssets') return pair('totalAssets', 'totalLiabilities', -1)
  return []
}

/** The printed total line this figure was read from, if any. */
function printedTotal(s: ExtractedFinancialStatement, half: StatementHalfKey, key: string, section: string | undefined, value: number): StatementLine | null {
  const totals = linesOf(s, half).filter((l) => l.isTotal && l.value !== null && near(l.value, value))
  return (
    totals.find((l) => l.canonicalKey === `totals.${key}`) ??
    (section ? totals.find((l) => l.section === section || (section === 'income' && l.section === 'otherIncome')) : undefined) ??
    null
  )
}

function explainTotal(
  half: StatementHalfKey,
  s: ExtractedFinancialStatement,
  key: string,
  value: number,
  candidates: ValueTerm[][],
  section: string | undefined,
): ValueSource {
  const file = fileOf(s, half)
  const terms = candidates.find((c) => near(sum(c), value))
  const line = printedTotal(s, half, key, section, value)
  if (line) return { kind: 'picked', sourceFilename: file, printed: [{ label: line.rawLabel, value: line.value as number }], ...(terms ? { terms } : {}) }
  if (terms) return { kind: 'calculated', sourceFilename: file, terms }
  return { kind: 'picked', sourceFilename: file }
}

/** An income statement total (Total Income, Gross Profit, ...): printed, or worked out. */
export function explainIncomeTotal(s: ExtractedFinancialStatement, key: string, value: number | null): ValueSource | null {
  if (value === null) return null
  const terms = incomeTotalTerms(s, key)
  const source = explainTotal('income_statement', s, key, value, terms ? [terms] : [], IS_TOTAL_SECTION[key])
  const pbt = num(s.incomeStatement.totals.profitBeforeTax)
  if (source.kind === 'picked' && !source.printed && key === 'netProfitAfterTax' && pbt !== null && near(pbt, value)) {
    return {
      kind: 'calculated',
      sourceFilename: source.sourceFilename,
      terms: [{ label: INCOME_STATEMENT_SCHEMA.totals.profitBeforeTax, value: pbt, sign: 1 }],
      note: 'No income tax on the statement, so net profit after tax equals profit before tax.',
    }
  }
  return source
}

/** A balance sheet total (Total Assets, Net Assets, ...): printed, or worked out. */
export function explainBalanceTotal(s: ExtractedFinancialStatement, key: string, value: number | null): ValueSource | null {
  if (value === null) return null
  return explainTotal('balance_sheet', s, key, value, balanceTotalTerms(s, key), BS_TOTAL_SECTION[key])
}

/** The net director / related-party loan account: receivable less payable. */
export function explainLoanAccountNet(s: ExtractedFinancialStatement, _key: string, value: number | null): ValueSource | null {
  if (value === null) return null
  const L = BALANCE_SHEET_SCHEMA
  return {
    kind: 'calculated',
    sourceFilename: fileOf(s, 'balance_sheet'),
    terms: [
      { label: L.nonCurrentAssets.directorRelatedLoansReceivable, value: num(s.balanceSheet.nonCurrentAssets.directorRelatedLoansReceivable) ?? 0, sign: 1 },
      { label: L.nonCurrentLiabilities.directorRelatedLoansPayable, value: Math.abs(num(s.balanceSheet.nonCurrentLiabilities.directorRelatedLoansPayable) ?? 0), sign: -1 },
    ],
    note: 'Positive: the directors owe the company. Negative: the company owes them.',
  }
}

/** A trust's distribution rows. */
export function explainDistributionRow(s: ExtractedFinancialStatement, key: string, value: number | null): ValueSource | null {
  if (value === null) return null
  const file = fileOf(s, 'income_statement')
  const ap = s.incomeStatement.appropriations
  const pbt = num(s.incomeStatement.totals.profitBeforeTax)
  const distributions = num(ap?.distributions)
  const lines = linesOf(s, 'income_statement')
  if (key === 'profitBeforeDistributions') return explainIncomeTotal(s, 'profitBeforeTax', value)
  if (key === 'distributions') {
    const line = lines.find((l) => l.value !== null && l.canonicalKey === 'appropriations.distributions')
    return { kind: 'picked', sourceFilename: file, ...(line ? { printed: [{ label: line.rawLabel, value: Math.abs(line.value as number) }] } : {}) }
  }
  if (num(ap?.netProfitAfterDistributions) !== null) {
    const line = lines.find((l) => l.isTotal && l.value !== null && near(l.value, value))
    return { kind: 'picked', sourceFilename: file, ...(line ? { printed: [{ label: line.rawLabel, value }] } : {}) }
  }
  if (pbt === null || distributions === null) return { kind: 'picked', sourceFilename: file }
  return {
    kind: 'calculated',
    sourceFilename: file,
    terms: [
      { label: INCOME_STATEMENT_SCHEMA.totals.profitBeforeTax, value: pbt, sign: 1 },
      { label: 'Distributions to beneficiaries', value: Math.abs(distributions), sign: -1 },
    ],
  }
}
