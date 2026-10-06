import {
  classifyLoan,
  dictionaryKey,
  isDirectorLoanLabel,
  isIncomeTaxExpenseLabel,
  isLiabilitySection,
  isPriorYearLossLabel,
  normaliseLabel,
  type LoanClass,
} from './labels'
import { printedAmountsFor, printedRowsFor } from './printedNumbers'
import { BALANCE_SHEET_SCHEMA, INCOME_STATEMENT_SCHEMA } from './schema'
import type {
  ExtractedBalanceSheet,
  ExtractedIncomeStatement,
  ExtractionWarning,
  LineSection,
  StatementLine,
} from './types'

/**
 * Deterministic corrections over what the model returned for one column,
 * using the printed lines it also returned. Pure; never invents a figure.
 *
 *   1. Dictionary: a label labels.ts knows is moved to its key, whatever the
 *      model chose ("Rental Bond" is never property, plant & equipment).
 *   2. Stock: closing stock is kept positive (it is subtracted).
 *   3. Appropriations: distributions, dividends and prior-year losses are
 *      taken off the profit line into incomeStatement.appropriations.
 *   4. Profit: a "profit after deducting prior-year losses" figure is never
 *      profit before or after tax; and with no income tax line — or for a
 *      trust, which pays no tax itself — net profit after tax IS profit
 *      before tax.
 *
 * And across the two columns of one file: a printed total that matches the
 * OTHER column's lines, not its own, was printed in the wrong column.
 *
 * correctFile() runs every step over every column of one file, so the
 * primary and comparative columns always get identical treatment:
 *
 *   signs     a figure printed as negative with a trailing or spaced minus,
 *             read back from our own text layer
 *   rebuild   when a statement's line list is complete — its lines add up to
 *             the printed total of this column OR the other one (totals
 *             printed in the wrong column), or the balance sheet balances
 *             from its lines within $5 — its figures are rebuilt from the
 *             lines; otherwise the model's figures are kept, with a note
 *   loans     director-related only when the name matches a director on file;
 *             vehicle/equipment or lender names are finance; anything else is
 *             kept as loans & finance with a "director or lender?" note
 *   notes     unmapped lines and unconfirmed loans noted from the lines,
 *             identically for every year and column
 */

export const LINE_TOLERANCE = 50

const IS_SECTIONS: LineSection[] = ['income', 'otherIncome', 'cogs', 'expenses', 'incomeTax', 'appropriation', 'incomeTotals']

export function isIncomeStatementSection(section: LineSection): boolean {
  return IS_SECTIONS.includes(section)
}

const IS_TOTAL_KEYS = new Set(['totalIncome', 'totalCogs', 'grossProfit', 'totalExpenses', 'profitBeforeTax', 'netProfitAfterTax'])
const IS_CATEGORIES = new Set(['income', 'cogs', 'expenses'])
const BS_CATEGORIES = new Set(['currentAssets', 'nonCurrentAssets', 'currentLiabilities', 'nonCurrentLiabilities', 'equity'])

const money = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-AU')}`

export interface Statements {
  incomeStatement: ExtractedIncomeStatement
  balanceSheet: ExtractedBalanceSheet
}

interface Location {
  object: Record<string, unknown>
  key: string
  /** For an entry in an "other" bucket: the section holding the bucket. */
  parent?: Record<string, unknown>
}

/**
 * Where a "section.key" (or "section.other.Name") lives. Null for keys that
 * name no stored figure ("ignore.*", unknown sections).
 */
function locate(s: Statements, path: string | null, create: boolean): Location | null {
  if (!path) return null
  const [section, key, ...rest] = path.split('.')
  if (!section || !key) return null
  let container: Record<string, unknown> | undefined
  if (section === 'totals') {
    container = (IS_TOTAL_KEYS.has(key) ? s.incomeStatement.totals : s.balanceSheet.totals) as Record<string, unknown>
  } else if (section === 'appropriations') {
    if (!s.incomeStatement.appropriations && create) s.incomeStatement.appropriations = {}
    container = s.incomeStatement.appropriations as Record<string, unknown> | undefined
  } else if (IS_CATEGORIES.has(section)) {
    container = (s.incomeStatement as unknown as Record<string, Record<string, unknown>>)[section]
  } else if (BS_CATEGORIES.has(section)) {
    container = (s.balanceSheet as unknown as Record<string, Record<string, unknown>>)[section]
  }
  if (!container) return null
  if (key === 'other') {
    const name = rest.join('.')
    if (!name) return null
    if (!container.other && create) container.other = {}
    const other = container.other as Record<string, unknown> | undefined
    return other ? { object: other, key: name, parent: container } : null
  }
  return { object: container, key }
}

function add(loc: Location, value: number) {
  const current = typeof loc.object[loc.key] === 'number' ? (loc.object[loc.key] as number) : 0
  loc.object[loc.key] = current + value
}

function subtract(loc: Location, value: number): boolean {
  const current = loc.object[loc.key]
  if (typeof current !== 'number') return false
  const left = current - value
  // Cent precision: a line of a few cents ("Rounding 0.02") must still find its residue.
  if (Math.abs(left) < 0.005) delete loc.object[loc.key]
  else loc.object[loc.key] = left
  // An emptied "other" bucket goes with its last entry.
  if (loc.parent && Object.keys(loc.object).length === 0) delete loc.parent.other
  return true
}

/** The "other" entry the model filed an unmapped line under, by its label. */
/**
 * The "other" entry the model filed an unmapped line under. The model names
 * these entries loosely, so: the exact label, then the same label normalised,
 * then the one entry holding exactly this line's value.
 */
function otherEntryFor(s: Statements, line: StatementLine): Location | null {
  const categories = new Set<string>()
  const modelCategory = line.canonicalKey?.split('.')[0]
  if (modelCategory) categories.add(modelCategory)
  categories.add(line.section === 'otherIncome' ? 'income' : line.section)

  for (const category of categories) {
    const bucket = locate(s, `${category}.other.${line.rawLabel}`, false)
    if (!bucket) continue
    const entries = Object.entries(bucket.object).filter(([, v]) => typeof v === 'number') as Array<[string, number]>
    const exact = entries.find(([k]) => k === line.rawLabel)
    const normalised = entries.find(([k]) => normaliseLabel(k) === normaliseLabel(line.rawLabel))
    const byValue = line.value === null ? [] : entries.filter(([, v]) => Math.abs(v - (line.value as number)) < 0.5)
    const hit = exact ?? normalised ?? (byValue.length === 1 ? byValue[0] : undefined)
    if (hit) return { object: bucket.object, key: hit[0], parent: bucket.parent }
  }
  return null
}

function sameKey(model: string | null, wanted: string): boolean {
  if (!model) return false
  if (model === wanted) return true
  // "nonCurrentAssets.other" for an "other.<name>" entry is the same bucket.
  return wanted.startsWith(`${model}.`) && model.endsWith('.other')
}

/**
 * Move one line's value from where the model put it to `wanted`. Returns
 * whether it moved. A line the model put nowhere we can find is left alone:
 * adding it without taking it out somewhere would count it twice.
 */
export function moveLine(s: Statements, line: StatementLine, wanted: string, absolute = false): boolean {
  if (line.value === null || sameKey(line.canonicalKey, wanted)) return false
  const value = line.value
  const fromTotal = line.canonicalKey?.startsWith('totals.') ?? false
  // A misread profit BEFORE tax is rebuilt from the totals by correctProfit,
  // which needs to see it; only net profit after tax is simply cleared here.
  if (fromTotal && line.canonicalKey !== 'totals.netProfitAfterTax') return false
  const from = locate(s, line.canonicalKey, false) ?? otherEntryFor(s, line)

  // A figure the model filed as a total (net profit) is cleared, not reduced.
  if (from && fromTotal) {
    if (typeof from.object[from.key] === 'number' && Math.abs((from.object[from.key] as number) - value) < 0.5) {
      delete from.object[from.key]
    }
  } else if (!from || !subtract(from, value)) {
    if (!wanted.startsWith('ignore.') && !wanted.startsWith('appropriations.')) return false
  }

  if (!wanted.startsWith('ignore.')) {
    const to = locate(s, wanted, true)
    if (!to) return false
    const stored = absolute || wanted === 'cogs.closingStock' || wanted.startsWith('appropriations.') ? Math.abs(value) : value
    if (wanted.startsWith('appropriations.')) to.object[to.key] = stored
    else add(to, stored)
  }
  line.canonicalKey = wanted
  return true
}

function readableKey(path: string | null): string {
  if (!path) return 'nothing'
  const last = path.split('.').pop() ?? path
  return last.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()
}

/**
 * One column's corrections. Mutates and returns `s`; the notes say what
 * changed. Without lines (older extractions) only the trust rule can apply.
 */
export interface CorrectionContext {
  isTrust: boolean
  /** Names of the client's directors (company_details.directors). */
  directors?: readonly string[]
}

const CATEGORY_OF: Partial<Record<LineSection, string>> = {
  income: 'income',
  otherIncome: 'income',
  cogs: 'cogs',
  expenses: 'expenses',
  currentAssets: 'currentAssets',
  nonCurrentAssets: 'nonCurrentAssets',
  currentLiabilities: 'currentLiabilities',
  nonCurrentLiabilities: 'nonCurrentLiabilities',
  equity: 'equity',
}

const SCHEMA_KEYS: Record<string, Set<string>> = {
  income: new Set(Object.keys(INCOME_STATEMENT_SCHEMA.income)),
  cogs: new Set(Object.keys(INCOME_STATEMENT_SCHEMA.cogs)),
  expenses: new Set(Object.keys(INCOME_STATEMENT_SCHEMA.expenses)),
  currentAssets: new Set(Object.keys(BALANCE_SHEET_SCHEMA.currentAssets)),
  nonCurrentAssets: new Set(Object.keys(BALANCE_SHEET_SCHEMA.nonCurrentAssets)),
  currentLiabilities: new Set(Object.keys(BALANCE_SHEET_SCHEMA.currentLiabilities)),
  nonCurrentLiabilities: new Set(Object.keys(BALANCE_SHEET_SCHEMA.nonCurrentLiabilities)),
  equity: new Set(Object.keys(BALANCE_SHEET_SCHEMA.equity)),
}

/** The model's key, if it names a real figure; "x.other" becomes "x.other.<label>". */
function validModelKey(line: StatementLine): string | null {
  const key = line.canonicalKey
  if (!key) return null
  const [category, name, ...rest] = key.split('.')
  if (category === 'appropriations' && name) return key
  if (!SCHEMA_KEYS[category] || !name) return null
  if (name === 'other') return `${category}.other.${rest.join('.') || line.rawLabel}`
  return SCHEMA_KEYS[category].has(name) ? `${category}.${name}` : null
}

export type KeySource = 'dictionary' | 'loan' | 'model' | 'fallback'

/** "Other" current liabilities holding the current portion of finance. */
export const CURRENT_ASSET_FINANCE = 'Vehicle & equipment finance (current)'
export const CURRENT_FINANCE = 'Loans & finance (current)'

export interface EffectiveKey {
  key: string | null
  source: KeySource
  loan?: LoanClass
  /** Store the line's value as a positive amount (a negative loan under liabilities is a receivable). */
  absolute?: boolean
}

/**
 * Where a printed line belongs, decided in this order: the label dictionary,
 * the loan rule (liabilities only), the model's key, then "other" in the
 * printed section. Null for lines that hold no figure of their own.
 */
export function effectiveKey(line: StatementLine, ctx: CorrectionContext, lines?: readonly StatementLine[]): EffectiveKey {
  // Unexpired interest follows the loan it belongs to, paired by name.
  const principal = lines ? principalFor(line, lines) : null
  if (principal) {
    const key = baseKey(principal, ctx).key
    if (key) return { key, source: 'loan', loan: 'lender' }
  }
  return baseKey(line, ctx)
}

const CHARGES_LINE = /\b(unexpired|interest|charges)\b/
const NOT_A_NAME = /\b(less|unexpired|interest|charges|on|loans?|finance|hire|purchase|hp|chattel|mortgages?|the|of|and|account|a c)\b/g

function nameTokens(rawLabel: string): string[] {
  return normaliseLabel(rawLabel).replace(NOT_A_NAME, ' ').split(' ').filter((t) => t.length >= 2)
}

/**
 * The loan an unexpired-interest line belongs to: the one other line in the
 * same printed section whose name holds every name word of the interest line
 * ("Less Unexpired Interest - VW" → "VW Finance"; "Loan - Hino Truck
 * Unexpired Interest" → "Loan - Hino Truck"). Null when there is not exactly one.
 */
export function principalFor(line: StatementLine, lines: readonly StatementLine[]): StatementLine | null {
  if (line.isTotal || !isLiabilitySection(line.section) || !CHARGES_LINE.test(normaliseLabel(line.rawLabel))) return null
  const wanted = nameTokens(line.rawLabel)
  if (wanted.length === 0) return null
  const candidates = lines.filter(
    (l) =>
      l !== line &&
      !l.isTotal &&
      l.section === line.section &&
      !CHARGES_LINE.test(normaliseLabel(l.rawLabel)) &&
      wanted.every((t) => nameTokens(l.rawLabel).includes(t)),
  )
  return candidates.length === 1 ? candidates[0] : null
}

/** Where a line belongs on its own, without pairing. */
function baseKey(line: StatementLine, ctx: CorrectionContext): EffectiveKey {
  const fromDictionary = dictionaryKey(line.rawLabel, line.section)
  if (fromDictionary) return { key: fromDictionary, source: 'dictionary' }

  const model = validModelKey(line)
  const fallbackCategory = CATEGORY_OF[line.section]
  const modelOrFallback: EffectiveKey = model
    ? { key: model, source: 'model' }
    : { key: fallbackCategory ? `${fallbackCategory}.other.${line.rawLabel}` : null, source: 'fallback' }

  // A director loan printed under liabilities with a NEGATIVE balance is money
  // owed TO the company: a director loan receivable, as a positive amount.
  if (
    isLiabilitySection(line.section) &&
    line.value !== null &&
    line.value < 0 &&
    isDirectorLoanLabel(line.rawLabel, ctx.directors ?? [])
  ) {
    return { key: 'nonCurrentAssets.directorRelatedLoansReceivable', source: 'loan', absolute: true }
  }

  if (isLiabilitySection(line.section)) {
    const loan = classifyLoan(line.rawLabel, ctx.directors ?? [])
    if (loan) {
      const nonCurrent = line.section === 'nonCurrentLiabilities'
      if (loan === 'director') return { key: 'nonCurrentLiabilities.directorRelatedLoansPayable', source: 'loan', loan }
      // The current portion of finance stays in current liabilities, netted
      // with its unexpired interest: never in chattel mortgages or loans &
      // finance, which are non-current.
      if (!nonCurrent) {
        if (loan === 'lender_asset') return { key: `currentLiabilities.other.${CURRENT_ASSET_FINANCE}`, source: 'loan', loan }
        if (loan === 'lender') return { key: `currentLiabilities.other.${CURRENT_FINANCE}`, source: 'loan', loan }
        if (modelOrFallback.key?.startsWith('currentLiabilities.')) return { ...modelOrFallback, loan }
        return { key: `currentLiabilities.other.${line.rawLabel}`, source: 'loan', loan }
      }
      if (loan === 'lender_asset') return { key: 'nonCurrentLiabilities.chattelMortgages', source: 'loan', loan }
      return { key: 'nonCurrentLiabilities.loansAndFinance', source: 'loan', loan }
    }
  }
  return modelOrFallback
}

// ─── Completeness ─────────────────────────────────────────────────────────────

const MATCH_TOLERANCE = 5
const IS_LINE_SECTIONS: LineSection[] = ['income', 'otherIncome', 'cogs', 'expenses']
const BS_LINE_SECTIONS: LineSection[] = ['currentAssets', 'nonCurrentAssets', 'currentLiabilities', 'nonCurrentLiabilities', 'equity']

function isClosingStock(line: StatementLine): boolean {
  return dictionaryKey(line.rawLabel, line.section) === 'cogs.closingStock'
}

/** A printed section's lines added up (closing stock taken off), or null with none. */
function linesTotal(lines: StatementLine[], section: LineSection): number | null {
  const items = lines.filter((l) => l.section === section && !l.isTotal && l.value !== null)
  if (items.length === 0) return null
  return items.reduce((sum, l) => sum + (isClosingStock(l) ? -Math.abs(l.value as number) : (l.value as number)), 0)
}

function lastPrintedTotal(lines: StatementLine[], section: LineSection): number | null {
  const totals = lines.filter((l) => l.section === section && l.isTotal && l.value !== null)
  return totals.length ? (totals[totals.length - 1].value as number) : null
}

const near = (a: number | null | undefined, b: number | null | undefined) =>
  typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= MATCH_TOLERANCE

/** Every section with lines adds up to its printed total — this column's or the other's. */
function sectionsAddUp(own: StatementLine[], other: StatementLine[] | null, sections: LineSection[]): boolean {
  const withLines = sections.filter((section) => linesTotal(own, section) !== null)
  if (withLines.length === 0) return false
  return withLines.every((section) => {
    const sum = linesTotal(own, section)
    return near(sum, lastPrintedTotal(own, section)) || (other !== null && near(sum, lastPrintedTotal(other, section)))
  })
}

/** Printed profit lines (not after prior-year losses), this column and the other. */
function printedProfits(own: Column, other: Column | null): number[] {
  const out: number[] = []
  for (const col of other ? [own, other] : [own]) {
    const pbt = col.incomeStatement.totals.profitBeforeTax
    if (typeof pbt === 'number') out.push(pbt)
    for (const l of col.lines) {
      if (l.section === 'incomeTotals' && l.value !== null && !isPriorYearLossLabel(l.rawLabel) && /\bprofit\b|\bloss\b/.test(normaliseLabel(l.rawLabel)) && !/\bgross\b/.test(normaliseLabel(l.rawLabel))) {
        out.push(l.value)
      }
    }
  }
  return out
}

export function isIncomeStatementComplete(own: Column, other: Column | null): boolean {
  if (sectionsAddUp(own.lines, other?.lines ?? null, IS_LINE_SECTIONS)) return true
  const parts = IS_LINE_SECTIONS.map((section) => linesTotal(own.lines, section))
  if (parts.every((p) => p === null)) return false
  const [income, otherIncome, cogs, expenses] = parts.map((p) => p ?? 0)
  const profit = income + otherIncome - cogs - expenses
  return printedProfits(own, other).some((p) => near(profit, p))
}

export function isBalanceSheetComplete(own: Column, other: Column | null): boolean {
  if (sectionsAddUp(own.lines, other?.lines ?? null, BS_LINE_SECTIONS)) return true
  const [ca, nca, cl, ncl, eq] = BS_LINE_SECTIONS.map((section) => linesTotal(own.lines, section))
  if (eq === null || (ca === null && nca === null)) return false
  return near((ca ?? 0) + (nca ?? 0) - (cl ?? 0) - (ncl ?? 0), eq)
}

// ─── Rebuild ──────────────────────────────────────────────────────────────────

/**
 * A statement's figures rebuilt from its lines: every line goes to its
 * effective key, and nothing else is kept. Totals and appropriations already
 * read stay; appropriations found in the lines are set.
 */
function rebuild(s: Statements, lines: StatementLine[], half: 'is' | 'bs', ctx: CorrectionContext) {
  const fresh: Statements =
    half === 'is'
      ? { incomeStatement: { income: {}, cogs: {}, expenses: {}, totals: s.incomeStatement.totals }, balanceSheet: s.balanceSheet }
      : { incomeStatement: s.incomeStatement, balanceSheet: { currentAssets: {}, nonCurrentAssets: {}, currentLiabilities: {}, nonCurrentLiabilities: {}, equity: {}, totals: s.balanceSheet.totals } }
  const sections = half === 'is' ? [...IS_LINE_SECTIONS, 'appropriation' as LineSection] : BS_LINE_SECTIONS

  for (const line of lines) {
    if (line.isTotal || line.value === null || !sections.includes(line.section)) continue
    const { key, absolute } = effectiveKey(line, ctx, lines)
    if (!key || key.startsWith('ignore.')) continue
    if (key.startsWith('appropriations.')) {
      if (!s.incomeStatement.appropriations) s.incomeStatement.appropriations = {}
      ;(s.incomeStatement.appropriations as Record<string, number>)[key.split('.')[1]] = Math.abs(line.value)
      line.canonicalKey = key
      continue
    }
    if ((half === 'is') !== IS_CATEGORIES.has(key.split('.')[0])) continue
    const to = locate(fresh, key, true)
    if (!to) continue
    add(to, absolute || key === 'cogs.closingStock' ? Math.abs(line.value) : line.value)
    line.canonicalKey = key
  }

  if (half === 'is') {
    s.incomeStatement.income = fresh.incomeStatement.income
    s.incomeStatement.cogs = fresh.incomeStatement.cogs
    s.incomeStatement.expenses = fresh.incomeStatement.expenses
  } else {
    s.balanceSheet.currentAssets = fresh.balanceSheet.currentAssets
    s.balanceSheet.nonCurrentAssets = fresh.balanceSheet.nonCurrentAssets
    s.balanceSheet.currentLiabilities = fresh.balanceSheet.currentLiabilities
    s.balanceSheet.nonCurrentLiabilities = fresh.balanceSheet.nonCurrentLiabilities
    s.balanceSheet.equity = fresh.balanceSheet.equity
  }
}

const SECTION_LABEL: Partial<Record<LineSection, string>> = {
  income: 'Income',
  otherIncome: 'Other Income',
  cogs: 'Cost of Sales',
  expenses: 'Expenses',
  currentAssets: 'Current Assets',
  nonCurrentAssets: 'Non-Current Assets',
  currentLiabilities: 'Current Liabilities',
  nonCurrentLiabilities: 'Non-Current Liabilities',
  equity: 'Equity',
}

/** Printed sections whose lines add up to a printed total (this column's or the other's), and why the rest do not. */
function sectionsThatAddUp(own: StatementLine[], other: StatementLine[] | null, sections: LineSection[]) {
  const ok = new Set<LineSection>()
  const reasons: string[] = []
  for (const section of sections) {
    const sum = linesTotal(own, section)
    if (sum === null) continue
    const printed = lastPrintedTotal(own, section)
    if (near(sum, printed) || (other !== null && near(sum, lastPrintedTotal(other, section)))) ok.add(section)
    else reasons.push(`${SECTION_LABEL[section] ?? section}: lines add to ${money(sum)}, ${printed === null ? 'no printed total read' : `printed total ${money(printed)}`}`)
  }
  return { ok, reasons }
}

/**
 * For a statement whose lines do not ALL add up: each category whose lines
 * all sit in printed sections that do add up is still rebuilt from its lines
 * (one wrong section must not leave a figure the lines contradict in another).
 * Returns the categories rebuilt.
 */
function rebuildCategoriesThatAddUp(target: Statements, column: Column, other: Column | null, half: 'is' | 'bs', ctx: CorrectionContext): string[] {
  const sections = half === 'is' ? IS_LINE_SECTIONS : BS_LINE_SECTIONS
  const categories = half === 'is' ? ['income', 'cogs', 'expenses'] : [...BS_CATEGORIES]
  const { ok } = sectionsThatAddUp(column.lines, other?.lines ?? null, sections)
  if (ok.size === 0) return []

  const items = column.lines
    .filter((l) => !l.isTotal && l.value !== null && sections.includes(l.section))
    .map((line) => ({ line, ek: effectiveKey(line, ctx, column.lines), model: validModelKey(line) ?? line.canonicalKey }))
  const categoryOf = (key: string | null | undefined) => key?.split('.')[0] ?? null

  const rebuilt = categories.filter((c) => {
    const into = items.filter((i) => categoryOf(i.ek.key) === c)
    return into.length > 0 && into.every((i) => ok.has(i.line.section))
  })
  if (rebuilt.length === 0) return []

  const statement = (half === 'is' ? target.incomeStatement : target.balanceSheet) as unknown as Record<string, Record<string, unknown>>
  for (const c of rebuilt) statement[c] = {}
  for (const { line, ek, model } of items) {
    const value = line.value as number
    const to = categoryOf(ek.key)
    if (!ek.key || ek.key.startsWith('ignore.') || ek.key.startsWith('appropriations.')) continue
    if (to !== null && rebuilt.includes(to)) {
      const loc = locate(target, ek.key, true)
      if (loc) add(loc, ek.absolute ? Math.abs(value) : value)
      line.canonicalKey = ek.key
    } else if (rebuilt.includes(categoryOf(model) ?? '')) {
      // Filed by the model in a rebuilt category but belonging elsewhere: the
      // rebuilt category no longer holds it, so it is placed where it belongs.
      const loc = locate(target, ek.key, true)
      if (loc) add(loc, ek.absolute ? Math.abs(value) : value)
      line.canonicalKey = ek.key
    }
  }
  return rebuilt
}

// ─── Signs ────────────────────────────────────────────────────────────────────

/** Our own text of a file's statement pages, and how many value columns they print. */
export interface PrintedText {
  is: readonly string[]
  bs: readonly string[]
  /** Value columns in the statements' headings (e.g. 2 for "2024 2023"). */
  columns: number
}

const fmt = (v: number | null) => (v === null ? '"-"' : money(v))

/**
 * Every line checked against the row our text layer prints for it: when the
 * row reads unambiguously (one value per column) and this column's printed
 * value differs from the model's, the printed value is used — catching a
 * model that slid a figure onto the next row. Rows that cannot be read
 * without guessing keep the model's value.
 */
/**
 * A label printed more than once with different figures ("Business Account"
 * under Current Assets and again under Current Liabilities): the n-th line
 * with that label reads the n-th printed row — when the statement prints the
 * label exactly as many times as the lines hold it, both in page order.
 */
function nthPrintedRow(line: StatementLine, lines: readonly StatementLine[], page: readonly string[], columns: number): Array<number | null> | null {
  const label = normaliseLabel(line.rawLabel)
  const half = isIncomeStatementSection(line.section)
  const same = lines.filter((l) => normaliseLabel(l.rawLabel) === label && isIncomeStatementSection(l.section) === half)
  const rows = printedRowsFor(line.rawLabel, page, columns)
  if (same.length < 2 || rows.length !== same.length) return null
  return rows[same.indexOf(line)] ?? null
}

/** A label that names a total or a result line, not an item. */
export function looksLikeTotal(rawLabel: string): boolean {
  return /^(less )?total\b|\btotal$|\bprofit\b|\bloss\b|^net\b|\bgross\b/.test(normaliseLabel(rawLabel))
}

/** The total a label names, when it names one unambiguously. */
const TOTAL_BY_LABEL: Array<[RegExp, string]> = [
  [/^total (trading )?(income|revenue|sales)$/, 'totals.totalIncome'],
  [/^total (cost of (goods )?sold|cost of sales|cogs|direct costs)$/, 'totals.totalCogs'],
  [/^gross (profit|margin)( on trading)?$/, 'totals.grossProfit'],
  [/^total (operating )?expenses( incurred)?$/, 'totals.totalExpenses'],
  [/^total current assets$/, 'totals.totalCurrentAssets'],
  [/^total non current assets$/, 'totals.totalNonCurrentAssets'],
  [/^total assets$/, 'totals.totalAssets'],
  [/^total current liabilities$/, 'totals.totalCurrentLiabilities'],
  [/^total non current liabilities$/, 'totals.totalNonCurrentLiabilities'],
  [/^total liabilities$/, 'totals.totalLiabilities'],
  [/^net assets( liabilities)?$/, 'totals.netAssets'],
  [/^total equity$/, 'totals.totalEquity'],
]

/**
 * Total flags follow the label. A model that slid its figures down a column
 * can slide the total flags with them: "Work Cover" marked as the expenses
 * total, "Total expenses incurred" filed as net profit. An item label is
 * never a total; a label that names a total gets that total.
 */
function fixTotalsByLabel(lines: StatementLine[]): ExtractionWarning[] {
  const moved: string[] = []
  for (const line of lines) {
    const label = normaliseLabel(line.rawLabel)
    const named = TOTAL_BY_LABEL.find(([pattern]) => pattern.test(label))?.[1] ?? null
    if (line.isTotal && !looksLikeTotal(line.rawLabel) && line.canonicalKey?.startsWith('totals.')) {
      moved.push(`"${line.rawLabel}" is not a total`)
      line.isTotal = false
      line.canonicalKey = null
    } else if (named && line.canonicalKey !== named && line.canonicalKey !== 'ignore.secondTotalIncome') {
      moved.push(`"${line.rawLabel}" is ${readableKey(named)}`)
      line.isTotal = true
      line.canonicalKey = named
    }
  }
  return moved.length
    ? [
        {
          kind: 'mapping_corrected',
          group: 'total_flags',
          message: `Totals were read on the wrong lines and were put back by their labels: ${moved.join('; ')}.`,
        },
      ]
    : []
}

function applyPrintedValues(column: Column, index: number, printed: PrintedText): ExtractionWarning[] {
  const notes: ExtractionWarning[] = []
  for (const line of column.lines) {
    const page = printed[isIncomeStatementSection(line.section) ? 'is' : 'bs']
    const row = printedAmountsFor(line.rawLabel, page, printed.columns) ?? nthPrintedRow(line, column.lines, page, printed.columns)
    if (!row) continue
    const value = row[index] ?? null
    const before = line.value
    if (value === before || (value !== null && before !== null && Math.abs(value - before) < 0.5)) continue

    line.value = value
    // Carry the change into where the model filed the figure. A section
    // rebuilt from its lines later is exact anyway; this keeps an
    // incomplete section's figures in step too.
    const loc = locate(column, validModelKey(line) ?? line.canonicalKey, value !== null)
    if (loc) {
      const current = typeof loc.object[loc.key] === 'number' ? (loc.object[loc.key] as number) : null
      if (line.canonicalKey?.startsWith('totals.')) {
        if (current === null || before === null || Math.abs(current - before) < 0.5) loc.object[loc.key] = value ?? 0
      } else {
        loc.object[loc.key] = (current ?? 0) - (before ?? 0) + (value ?? 0)
      }
    }

    const signOnly = value !== null && before !== null && Math.abs(Math.abs(value) - Math.abs(before)) < 0.5
    notes.push({
      kind: signOnly ? 'sign_corrected' : 'value_corrected',
      section: isIncomeStatementSection(line.section) ? 'incomeStatement' : 'balanceSheet',
      message: signOnly
        ? `"${line.rawLabel}" is printed as ${fmt(value)}; its sign was corrected.`
        : `"${line.rawLabel}" was read as ${fmt(before)}, but the statement prints ${fmt(value)} on that row. The printed figure was used.`,
    })
  }
  return notes
}

// ─── Printed nil and distributions ────────────────────────────────────────────

/**
 * A line printed with "-" exists and is nil: its figure is 0, not unknown.
 * Shown as $0; "—" stays for a line the year does not have at all.
 */
function zeroPrintedNils(target: Statements, lines: StatementLine[], ctx: CorrectionContext): ExtractionWarning[] {
  const notes: ExtractionWarning[] = []
  for (const line of lines) {
    if (line.value !== null) continue
    const key = line.isTotal ? validTotalKey(line) : effectiveKey({ ...line, value: 0 }, ctx, lines).key
    if (!key || key.startsWith('ignore.') || key.startsWith('appropriations.')) continue
    const loc = locate(target, key, true)
    if (!loc) continue
    if (loc.object[loc.key] === undefined) {
      loc.object[loc.key] = 0
      continue
    }
    // The model put ANOTHER line's figure here: every line of this key prints
    // "-", and the figure is exactly what a line filed elsewhere carries
    // ("Business Account" "-" under assets, 4,268 under liabilities).
    const current = loc.object[loc.key]
    if (line.isTotal || typeof current !== 'number' || current === 0) continue
    const ownLines = lines.filter((l) => !l.isTotal && effectiveKey({ ...l, value: l.value ?? 0 }, ctx, lines).key === key)
    if (ownLines.some((l) => l.value !== null)) continue
    const elsewhere = lines.find(
      (l) => !l.isTotal && l.value !== null && Math.abs(l.value - current) < 0.5 && effectiveKey(l, ctx, lines).key !== key,
    )
    if (!elsewhere) continue
    loc.object[loc.key] = 0
    notes.push({
      kind: 'mapping_corrected',
      section: isIncomeStatementSection(line.section) ? 'incomeStatement' : 'balanceSheet',
      group: 'nil_line',
      message: `${readableKey(key).replace(/^./, (c) => c.toUpperCase())} was read as ${money(current)}, the figure of "${elsewhere.rawLabel}" under ${readableKey(elsewhere.section)}. Its own line "${line.rawLabel}" prints "-", so it is $0.`,
    })
  }
  return notes
}

const SUBTOTALS: Array<[string, string, string, string, string, string]> = [
  ['totalAssets', 'currentAssets', 'nonCurrentAssets', 'totalCurrentAssets', 'totalNonCurrentAssets', 'assets'],
  ['totalLiabilities', 'currentLiabilities', 'nonCurrentLiabilities', 'totalCurrentLiabilities', 'totalNonCurrentLiabilities', 'liabilities'],
]

function categorySum(bs: ExtractedBalanceSheet, category: string): number | null {
  const figures = (bs as unknown as Record<string, Record<string, unknown> | undefined>)[category]
  if (!figures) return null
  const values = [
    ...Object.entries(figures).filter(([k]) => k !== 'other').map(([, v]) => v),
    ...Object.values((figures.other as Record<string, unknown> | undefined) ?? {}),
  ].filter((v): v is number => typeof v === 'number')
  return values.length ? values.reduce((a, b) => a + b, 0) : null
}

/**
 * Current and non-current subtotals that do not add up to the printed total
 * assets (or liabilities), when the figures do. Layouts that print "Bank",
 * "Current Assets", "Fixed Assets" and "Non-current Assets" under separate
 * headings have a "Total Non-current Assets" that leaves out the fixed
 * assets: the subtotals are then taken from the figures, which do add up.
 */
export function reconcileSubtotals(bs: ExtractedBalanceSheet): ExtractionWarning[] {
  const t = bs.totals as Record<string, number | null | undefined>
  const notes: ExtractionWarning[] = []
  for (const [whole, a, b, aKey, bKey, label] of SUBTOTALS) {
    const total = t[whole]
    if (typeof total !== 'number') continue
    const [printedA, printedB] = [t[aKey], t[bKey]]
    if (typeof printedA === 'number' && typeof printedB === 'number' && near(printedA + printedB, total)) continue
    const [fa, fb] = [categorySum(bs, a), categorySum(bs, b)]
    if (fa === null || fb === null || !near(fa + fb, total)) continue
    const changed: string[] = []
    if (!near(printedA, fa)) changed.push(`total current ${label} ${printedA == null ? 'blank' : money(printedA)} → ${money(fa)}`)
    if (!near(printedB, fb)) changed.push(`total non-current ${label} ${printedB == null ? 'blank' : money(printedB)} → ${money(fb)}`)
    if (changed.length === 0) continue
    t[aKey] = fa
    t[bKey] = fb
    notes.push({
      kind: 'mapping_corrected',
      section: 'balanceSheet',
      group: 'subtotals',
      message: `Current and non-current ${label} did not add up to total ${label} (${money(total)}); the statement prints them under separate headings, so the subtotals were taken from the lines: ${changed.join('; ')}.`,
    })
  }
  return notes
}

function validTotalKey(line: StatementLine): string | null {
  const key = line.canonicalKey
  return key && /^totals\.[a-zA-Z]+$/.test(key) ? key : null
}

const DISTRIBUTION_HEADING = /\b(distributions?|distributed) (to|among) beneficiar|\bbeneficiar(y|ies)( distributions?)?$|^distributions?$/
const NOT_A_BENEFICIARY = /\b(profit|loss|income|undistributed|retained|total|tax|balance|brought forward|carried forward)\b/

/**
 * Distributions to beneficiaries, from the appropriation lines: the printed
 * "DISTRIBUTION TO BENEFICIARIES" figure when it carries one, otherwise the
 * named beneficiary lines printed under it; $0 when the heading, or every
 * beneficiary under it, prints "-". Null when there is no such heading.
 */
export function distributionsFromLines(lines: StatementLine[]): number | null {
  const start = lines.findIndex(
    (l) => (l.section === 'appropriation' || l.section === 'incomeTotals' || l.section === 'equity') && DISTRIBUTION_HEADING.test(normaliseLabel(l.rawLabel)),
  )
  if (start === -1) return null
  const heading = lines[start]
  if (heading.value !== null && heading.value !== 0) return Math.abs(heading.value)

  let sum: number | null = null
  for (const l of lines.slice(start + 1)) {
    if (l.section !== heading.section) break
    if (l.isTotal) {
      if (l.value !== null) return Math.abs(l.value)
      break
    }
    if (NOT_A_BENEFICIARY.test(normaliseLabel(l.rawLabel)) || isPriorYearLossLabel(l.rawLabel)) break
    if (l.value !== null) sum = (sum ?? 0) + Math.abs(l.value)
  }
  // The heading printed, and it or every beneficiary under it shows "-": $0.
  return sum ?? 0
}

// ─── Per column, per file ─────────────────────────────────────────────────────

function categoryLabel(key: string): string {
  return readableKey(key.split('.')[0] ?? key)
}

/**
 * Notes made from the lines' FINAL mapping — run after the label dictionary,
 * the loan rule and the cross-file consistency pass, so a note never
 * contradicts where a line ended up. The same for every year and column.
 */
export function finalLineNotes(lines: StatementLine[], ctx: CorrectionContext): ExtractionWarning[] {
  const notes: ExtractionWarning[] = []
  for (const line of lines) {
    if (line.isTotal || line.value === null || !line.canonicalKey) continue
    const section = isIncomeStatementSection(line.section) ? 'incomeStatement' : 'balanceSheet'
    if (isLiabilitySection(line.section) && classifyLoan(line.rawLabel, ctx.directors ?? []) === 'unconfirmed') {
      notes.push({
        kind: 'loan_unconfirmed',
        section,
        message: `Loan '${line.rawLabel}': director or lender? Confirm. It is shown under loans & finance until confirmed.`,
      })
      continue
    }
    const finalKey = line.canonicalKey
    if (!finalKey.includes('.other') || dictionaryKey(line.rawLabel, line.section)) continue
    // Current finance has its own named "other" line: placed, not unmapped.
    if (finalKey.endsWith(`.${CURRENT_ASSET_FINANCE}`) || finalKey.endsWith(`.${CURRENT_FINANCE}`)) continue
    notes.push({
      kind: 'unmapped_line_item',
      section,
      rawLabel: line.rawLabel,
      message: `"${line.rawLabel}" is not one of the standard lines; it is kept under other ${categoryLabel(finalKey)}.`,
      group: `unmapped:${categoryLabel(finalKey)}`,
    })
  }
  return notes
}

// ─── Total income, gross profit, director loans ───────────────────────────────

const TOTAL_INCOME = /^total (trading )?income$/

/**
 * Some templates print "Total Income" twice: first the total trading income,
 * then — after cost of sales and other income — gross profit plus other
 * income. Only the FIRST is total income, decided by printed order (our own
 * text layer when it reads the row, otherwise the order of the returned
 * lines). Later ones are presentation subtotals and are set aside.
 */
function fixTotalIncome(target: Statements, lines: StatementLine[], firstPrinted: number | null): ExtractionWarning[] {
  const occurrences = lines.filter((l) => TOTAL_INCOME.test(normaliseLabel(l.rawLabel)))
  if (occurrences.length < 2) return []
  for (const later of occurrences.slice(1)) {
    later.section = 'incomeTotals'
    later.canonicalKey = 'ignore.secondTotalIncome'
  }
  const first = firstPrinted ?? occurrences[0].value
  const totals = target.incomeStatement.totals as Record<string, number | null | undefined>
  if (first === null || totals.totalIncome === first) return []
  const before = totals.totalIncome
  totals.totalIncome = first
  return [
    {
      kind: 'mapping_corrected',
      section: 'incomeStatement',
      group: 'total_income',
      message: `Total income was read as ${before == null ? 'blank' : money(before)}, from a later "Total Income" line (gross profit plus other income). The first "Total Income", ${money(first)}, was used.`,
    },
  ]
}

/**
 * Gross profit with no "Gross Profit" line printed: total income less cost of
 * sales — never a later "Total Income" subtotal.
 */
function fixGrossProfit(target: Statements, lines: StatementLine[]): ExtractionWarning[] {
  if (lines.length === 0 || lines.some((l) => /^gross (profit|margin)\b/.test(normaliseLabel(l.rawLabel)))) return []
  const totals = target.incomeStatement.totals as Record<string, number | null | undefined>
  if (typeof totals.totalIncome !== 'number') return []
  const computed = totals.totalIncome - (typeof totals.totalCogs === 'number' ? totals.totalCogs : 0)
  if (typeof totals.grossProfit === 'number' && Math.abs(totals.grossProfit - computed) < 0.5) return []
  const before = totals.grossProfit
  totals.grossProfit = computed
  return before == null
    ? []
    : [
        {
          kind: 'mapping_corrected',
          section: 'incomeStatement',
          group: 'gross_profit',
          message: `No "Gross Profit" line is printed, so gross profit is total income less cost of sales: ${money(computed)} (it had been read as ${money(before)}).`,
        },
      ]
}

function negativeLoanNotes(lines: StatementLine[], ctx: CorrectionContext): ExtractionWarning[] {
  return lines
    .filter((l) => !l.isTotal && l.value !== null && effectiveKey(l, ctx).absolute)
    .map((l) => ({
      kind: 'mapping_corrected' as const,
      section: 'balanceSheet',
      group: 'negative_loan',
      message: `"${l.rawLabel}" is printed under liabilities as ${money(l.value as number)}: money owed to the company, shown as a director loan receivable of ${money(Math.abs(l.value as number))}.`,
    }))
}

/** A director loan receivable is never negative. */
function guardNegativeReceivable(target: Statements): ExtractionWarning[] {
  const nca = target.balanceSheet.nonCurrentAssets as Record<string, number | null | undefined>
  const value = nca.directorRelatedLoansReceivable
  if (typeof value !== 'number' || value >= 0) return []
  nca.directorRelatedLoansReceivable = Math.abs(value)
  return [
    {
      kind: 'mapping_corrected',
      section: 'balanceSheet',
      group: 'negative_loan',
      message: `Director loans receivable was read as ${money(value)}; a receivable cannot be negative, so it is shown as ${money(Math.abs(value))}.`,
    },
  ]
}

/**
 * A group heading the model gave its group's total ("Bank overdraft 4,268",
 * then "Business Account 4,268", then "Total Bank overdraft 4,268"): the
 * heading carries no figure of its own, so it is set aside — otherwise the
 * group counts twice.
 */
function dropHeadingEchoes(lines: StatementLine[]): ExtractionWarning[] {
  const notes: ExtractionWarning[] = []
  lines.forEach((heading, i) => {
    if (heading.isTotal || heading.value === null) return
    const label = normaliseLabel(heading.rawLabel)
    const t = lines.findIndex((l, j) => j > i && l.isTotal && l.section === heading.section && normaliseLabel(l.rawLabel) === `total ${label}`)
    if (t === -1) return
    const total = lines[t]
    const inside = lines.slice(i + 1, t).filter((l) => !l.isTotal && l.section === heading.section)
    if (inside.length === 0 || total.value === null || Math.abs(total.value - heading.value) >= 0.5) return
    heading.isTotal = true
    heading.canonicalKey = 'ignore.heading'
    notes.push({
      kind: 'mapping_corrected',
      section: isIncomeStatementSection(heading.section) ? 'incomeStatement' : 'balanceSheet',
      group: 'heading',
      message: `"${heading.rawLabel}" is a heading: its ${money(total.value)} is the total of the lines under it, so it is not counted again.`,
    })
  })
  return notes
}

/**
 * An overdraft read twice: as the overdraft under liabilities, and again as a
 * NEGATIVE bank balance under assets. The asset line is the same money (its
 * row prints "-"); it is taken as nil.
 */
function dropMirroredOverdrafts(lines: StatementLine[], ctx: CorrectionContext): ExtractionWarning[] {
  const notes: ExtractionWarning[] = []
  const overdrafts = lines.filter(
    (l) => !l.isTotal && l.value !== null && l.value > 0 && effectiveKey(l, ctx).key === 'currentLiabilities.bankOverdraft',
  )
  for (const l of lines) {
    if (l.isTotal || l.value === null || l.value >= 0 || effectiveKey(l, ctx).key !== 'currentAssets.bankAccounts') continue
    const mirror = overdrafts.find((o) => Math.abs(o.value! + (l.value as number)) < 0.5)
    if (!mirror) continue
    notes.push({
      kind: 'mapping_corrected',
      section: 'balanceSheet',
      group: 'nil_line',
      message: `"${l.rawLabel}" was read as ${money(l.value)} under assets, the overdraft "${mirror.rawLabel}" under liabilities read a second time; it is taken as "-".`,
    })
    l.value = null
  }
  return notes
}

/** One column, without the other column of its file to compare against. */
export function correctColumn(s: Statements, lines: StatementLine[], ctx: CorrectionContext): ExtractionWarning[] {
  return correctOne({ ...s, lines }, null, ctx, s)
}

function correctOne(
  column: Column,
  other: Column | null,
  ctx: CorrectionContext,
  target: Statements,
  firstPrintedTotalIncome: number | null = null,
): ExtractionWarning[] {
  const notes: ExtractionWarning[] = []
  const lines = column.lines

  notes.push(...fixTotalIncome(target, lines, firstPrintedTotalIncome))
  notes.push(...dropHeadingEchoes(lines))
  notes.push(...dropMirroredOverdrafts(lines, ctx))

  for (const [half, complete, label] of [
    ['is', lines.some((l) => IS_LINE_SECTIONS.includes(l.section)) && isIncomeStatementComplete(column, other), 'Income Statement'],
    ['bs', lines.some((l) => BS_LINE_SECTIONS.includes(l.section)) && isBalanceSheetComplete(column, other), 'Balance Sheet'],
  ] as const) {
    const hasLines = lines.some((l) => (half === 'is' ? IS_LINE_SECTIONS : BS_LINE_SECTIONS).includes(l.section))
    if (!hasLines) continue
    if (complete) {
      rebuild(target, lines, half, ctx)
      continue
    }
    // Lines that do not add up: keep the model's figures — except categories
    // whose lines all sit in sections that do add up — moving only lines
    // whose place is certain (dictionary and loan rule).
    const sections = half === 'is' ? IS_LINE_SECTIONS : BS_LINE_SECTIONS
    const { reasons } = sectionsThatAddUp(lines, other?.lines ?? null, sections)
    const rebuilt = rebuildCategoriesThatAddUp(target, column, other, half, ctx)
    const kept = rebuilt.length
      ? `figures were kept as read, except ${rebuilt.map(readableKey).join(', ')}, rebuilt from lines that do add up`
      : 'the extracted figures were kept as read'
    notes.push({
      kind: 'lines_incomplete',
      section: half === 'is' ? 'incomeStatement' : 'balanceSheet',
      message: `The ${label} line items did not add up to its printed totals (${reasons.length ? reasons.join('; ') : `${half === 'bs' ? 'assets less liabilities' : 'income less costs'} did not match`}), so ${kept}.`,
    })
    for (const line of lines) {
      if (line.isTotal || !(half === 'is' ? IS_LINE_SECTIONS : BS_LINE_SECTIONS).includes(line.section)) continue
      const ek = effectiveKey(line, ctx, lines)
      if ((ek.source === 'dictionary' || ek.source === 'loan') && ek.key) moveLine(target, line, ek.key, ek.absolute)
    }
  }

  // Appropriation and profit-subtotal lines, wherever they sit.
  for (const line of lines) {
    const key = dictionaryKey(line.rawLabel, line.section)
    if (key && (key.startsWith('appropriations.') || key.startsWith('ignore.'))) moveLine(target, line, key)
  }

  const cogs = target.incomeStatement.cogs as Record<string, number | null | undefined>
  if (typeof cogs.closingStock === 'number') cogs.closingStock = Math.abs(cogs.closingStock)

  // Distributions to beneficiaries, from the heading or the named lines under it.
  const distributions = distributionsFromLines(lines)
  if (distributions !== null) {
    if (lines.some((l) => isIncomeStatementSection(l.section) && DISTRIBUTION_HEADING.test(normaliseLabel(l.rawLabel)))) {
      target.incomeStatement.appropriations = { ...target.incomeStatement.appropriations, distributions }
    } else {
      ;(target.balanceSheet.equity as Record<string, number>).distributions = distributions
    }
  } else if (target.incomeStatement.appropriations?.distributions == null) {
    // Beneficiary lines printed under the appropriation without their
    // "DISTRIBUTION TO BENEFICIARIES" heading: they are the distribution
    // ($0 when each prints "-").
    const beneficiaries = lines.filter(
      (l) =>
        l.section === 'appropriation' &&
        !l.isTotal &&
        !NOT_A_BENEFICIARY.test(normaliseLabel(l.rawLabel)) &&
        !isPriorYearLossLabel(l.rawLabel) &&
        !dictionaryKey(l.rawLabel, l.section),
    )
    if (beneficiaries.length > 0) {
      const sum = beneficiaries.reduce((total, l) => total + Math.abs(l.value ?? 0), 0)
      target.incomeStatement.appropriations = { ...target.incomeStatement.appropriations, distributions: sum }
    }
  }

  notes.push(...zeroPrintedNils(target, lines, ctx))
  if (lines.some((l) => BS_LINE_SECTIONS.includes(l.section))) notes.push(...reconcileSubtotals(target.balanceSheet))
  notes.push(...fixGrossProfit(target, lines))
  notes.push(...negativeLoanNotes(lines, ctx))
  notes.push(...guardNegativeReceivable(target))

  // Unmapped-line and loan notes are made when the comparison is built, after
  // the consistency pass, from the final mapping (see finalLineNotes).
  notes.push(...correctProfit(target, lines, ctx))
  return notes
}

export interface FileColumn extends Column {
  /** 0 for the primary (or only) column, 1 for the comparative. */
  index: number
}

/**
 * The printed total lines are the totals. The model also returns a totals
 * block, and it sometimes sums the rounded lines there instead of reading
 * the printed total (288,183 where the statement prints 288,185): where a
 * printed total line carries a figure, it wins.
 */
function totalsFromPrintedLines(column: Column): ExtractionWarning[] {
  const notes: ExtractionWarning[] = []
  for (const line of column.lines) {
    // Only a line that names a total: a slid "Work Cover" marked as the
    // expenses total must never set it.
    const key = line.isTotal && line.value !== null && looksLikeTotal(line.rawLabel) ? validTotalKey(line) : null
    if (!key) continue
    const loc = locate(column, key, true)
    if (!loc) continue
    const current = loc.object[loc.key]
    if (typeof current === 'number' && Math.abs(current - (line.value as number)) < 0.5) continue
    loc.object[loc.key] = line.value
    if (typeof current === 'number') {
      notes.push({
        kind: 'value_corrected',
        section: isIncomeStatementSection(line.section) ? 'incomeStatement' : 'balanceSheet',
        message: `${readableKey(key).replace(/^./, (c) => c.toUpperCase())} was read as ${money(current)}; the statement prints ${money(line.value as number)} on its "${line.rawLabel}" line. The printed figure was used.`,
      })
    }
  }
  return notes
}

/**
 * Every column of one file, the same way. `printed` is our own text of the
 * file's statement pages, which every line is checked against. Returns each
 * column's notes, and the file's own notes.
 */
export function correctFile(
  columns: FileColumn[],
  ctx: CorrectionContext,
  printed: PrintedText | null,
): { columnNotes: ExtractionWarning[][]; fileNotes: ExtractionWarning[] } {
  const columnNotes = columns.map(() => [] as ExtractionWarning[])
  const fileNotes: ExtractionWarning[] = []

  // Total flags by label first, so figures corrected below land on the right keys.
  columns.forEach((column, i) => columnNotes[i].push(...fixTotalsByLabel(column.lines)))
  if (printed) {
    columns.forEach((column, i) => columnNotes[i].push(...applyPrintedValues(column, column.index, printed)))
  }
  columns.forEach((column, i) => columnNotes[i].push(...totalsFromPrintedLines(column)))

  // Totals printed in the wrong column are put right before anything is
  // checked against them.
  if (columns.length === 2 && fixSwappedTotals(columns[0], columns[1])) {
    fileNotes.push({
      kind: 'swapped_totals',
      message: 'Totals in this file appear to be printed in the wrong column; figures were taken from the line items.',
    })
  }

  // The first "Total Income" row, read from our own text in printed order.
  const totalIncomeRows = printed ? printedRowsFor('Total Income', printed.is, printed.columns) : []
  const firstTotalIncome = totalIncomeRows.length > 1 ? totalIncomeRows[0] : null

  columns.forEach((column, i) => {
    const other = columns.length === 2 ? columns[1 - i] : null
    columnNotes[i].push(...correctOne(column, other, ctx, column, firstTotalIncome?.[column.index] ?? null))
  })
  return { columnNotes, fileNotes }
}

/**
 * 4. Profit. Run on every column at extraction, and again on stored
 * statements when the comparison is built (where, without lines, only the
 * trust rule applies).
 */
export function correctProfit(
  s: Statements,
  lines: StatementLine[],
  { isTrust }: Pick<CorrectionContext, 'isTrust'>,
): ExtractionWarning[] {
  const notes: ExtractionWarning[] = []
  const t = s.incomeStatement.totals as Record<string, number | null | undefined>
  const priorLossLine = lines.find((l) => isPriorYearLossLabel(l.rawLabel))

  // Profit before tax read from a "profit after deducting prior-year losses"
  // line: rebuild it from the totals when they are all there.
  if (typeof t.profitBeforeTax === 'number' && priorLossLine?.value != null) {
    const afterLoss = lines.filter((l) => isPriorYearLossLabel(l.rawLabel) && l.value != null)
    const fromLossLine = afterLoss.some((l) => Math.abs((l.value as number) - (t.profitBeforeTax as number)) < 0.5)
    const { totalIncome, totalCogs, totalExpenses } = t
    if (fromLossLine && typeof totalIncome === 'number' && typeof totalExpenses === 'number') {
      const computed = totalIncome - (totalCogs ?? 0) - totalExpenses
      if (Math.abs(computed - t.profitBeforeTax) > 1) {
        notes.push({
          kind: 'profit_corrected',
          section: 'incomeStatement',
          message: `Profit before tax was read as ${money(t.profitBeforeTax)} from "${priorLossLine.rawLabel}", a figure after prior-year losses. It was taken as income less cost of sales and expenses: ${money(computed)}.`,
        })
        t.profitBeforeTax = computed
      }
    }
  }

  const pbt = t.profitBeforeTax
  if (typeof pbt !== 'number') return notes

  const hasTaxLine = lines.some(
    (l) => !l.isTotal && l.value != null && l.value !== 0 && (l.section === 'incomeTax' || isIncomeTaxExpenseLabel(l.rawLabel)),
  )
  const noTax = isTrust || (lines.length > 0 && !hasTaxLine)
  if (!noTax) return notes

  if (typeof t.netProfitAfterTax !== 'number') {
    t.netProfitAfterTax = pbt
  } else if (Math.abs(t.netProfitAfterTax - pbt) > 1) {
    const why = isTrust ? 'a trust pays no tax itself' : 'the statement shows no income tax expense'
    const what = priorLossLine ? ` It looks like the figure after "${priorLossLine.rawLabel}".` : ''
    notes.push({
      kind: 'profit_corrected',
      section: 'incomeStatement',
      message: `Net profit after tax was read as ${money(t.netProfitAfterTax)}; as ${why}, it equals profit before tax, ${money(pbt)}.${what}`,
    })
    t.netProfitAfterTax = pbt
  }
  return notes
}

// ─── Swapped total columns ────────────────────────────────────────────────────

/** Section -> the canonical total its printed total line feeds. */
const SECTION_TOTALS: Array<[LineSection, 'is' | 'bs', string]> = [
  ['income', 'is', 'totalIncome'],
  ['cogs', 'is', 'totalCogs'],
  ['expenses', 'is', 'totalExpenses'],
  ['currentAssets', 'bs', 'totalCurrentAssets'],
  ['nonCurrentAssets', 'bs', 'totalNonCurrentAssets'],
  ['currentLiabilities', 'bs', 'totalCurrentLiabilities'],
  ['nonCurrentLiabilities', 'bs', 'totalNonCurrentLiabilities'],
]

/** The lines of a section added up, closing stock taken off. Null with no lines. */
function sectionSum(lines: StatementLine[], section: LineSection): number | null {
  const items = lines.filter((l) => l.section === section && !l.isTotal && l.value !== null)
  if (items.length === 0) return null
  return items.reduce((sum, l) => {
    const closing = section === 'cogs' && /closing (stock|inventory)/.test(normaliseLabel(l.rawLabel))
    return sum + (closing ? -Math.abs(l.value as number) : (l.value as number))
  }, 0)
}

function printedTotal(lines: StatementLine[], section: LineSection): number | null {
  const totals = lines.filter((l) => l.section === section && l.isTotal && l.value !== null)
  return totals.length ? (totals[totals.length - 1].value as number) : null
}

export interface Column extends Statements {
  lines: StatementLine[]
}

/**
 * Two columns of one file. A printed total that disagrees with its own
 * column's lines but matches the other column's is in the wrong column: the
 * total is taken from its own lines. Returns whether any were fixed.
 */
export function fixSwappedTotals(a: Column, b: Column): boolean {
  let fixed = false
  for (const [own, other] of [
    [a, b],
    [b, a],
  ] as const) {
    for (const [section, half, key] of SECTION_TOTALS) {
      const printed = printedTotal(own.lines, section)
      const otherPrinted = printedTotal(other.lines, section)
      const mine = sectionSum(own.lines, section)
      const theirs = sectionSum(other.lines, section)
      if (printed === null || otherPrinted === null || mine === null || theirs === null) continue
      if (Math.abs(printed - mine) <= LINE_TOLERANCE) continue
      if (Math.abs(printed - theirs) > LINE_TOLERANCE) continue
      // A real swap goes both ways: the other column's printed total is this
      // column's lines. And two near-identical columns (a current period
      // beside the year end, the same loans in both) prove nothing — a total
      // that merely resembles the other column is not a swap.
      if (Math.abs(otherPrinted - mine) > LINE_TOLERANCE) continue
      if (Math.abs(mine - theirs) <= LINE_TOLERANCE) continue
      const totals = (half === 'is' ? own.incomeStatement.totals : own.balanceSheet.totals) as Record<string, number | null | undefined>
      const stored = totals[key]
      // Only replace what came from the misplaced printed figure (or nothing).
      if (stored == null || Math.abs(stored - printed) <= LINE_TOLERANCE) {
        totals[key] = mine
        fixed = true
      }
    }
  }
  return fixed
}
