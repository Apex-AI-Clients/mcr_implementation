import {
  classifyLoan,
  dictionaryKey,
  isIncomeTaxExpenseLabel,
  isLiabilitySection,
  isPriorYearLossLabel,
  normaliseLabel,
  type LoanClass,
} from './labels'
import { printedAmountsFor } from './printedNumbers'
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
  if (Math.abs(left) < 0.5) delete loc.object[loc.key]
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
export function moveLine(s: Statements, line: StatementLine, wanted: string): boolean {
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
    const stored = wanted === 'cogs.closingStock' || wanted.startsWith('appropriations.') ? Math.abs(value) : value
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

export interface EffectiveKey {
  key: string | null
  source: KeySource
  loan?: LoanClass
}

/**
 * Where a printed line belongs, decided in this order: the label dictionary,
 * the loan rule (liabilities only), the model's key, then "other" in the
 * printed section. Null for lines that hold no figure of their own.
 */
export function effectiveKey(line: StatementLine, ctx: CorrectionContext): EffectiveKey {
  const fromDictionary = dictionaryKey(line.rawLabel, line.section)
  if (fromDictionary) return { key: fromDictionary, source: 'dictionary' }

  const model = validModelKey(line)
  const fallbackCategory = CATEGORY_OF[line.section]
  const modelOrFallback: EffectiveKey = model
    ? { key: model, source: 'model' }
    : { key: fallbackCategory ? `${fallbackCategory}.other.${line.rawLabel}` : null, source: 'fallback' }

  if (isLiabilitySection(line.section)) {
    const loan = classifyLoan(line.rawLabel, ctx.directors ?? [])
    if (loan) {
      const nonCurrent = line.section === 'nonCurrentLiabilities'
      if (loan === 'director') return { key: 'nonCurrentLiabilities.directorRelatedLoansPayable', source: 'loan', loan }
      if (!nonCurrent) return { ...modelOrFallback, loan }
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
    const { key } = effectiveKey(line, ctx)
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
    add(to, key === 'cogs.closingStock' ? Math.abs(line.value) : line.value)
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

// ─── Signs ────────────────────────────────────────────────────────────────────

/** Give each line the sign the PDF prints, when the text layer shows it unambiguously. */
function applyPrintedSigns(
  column: Column,
  index: number,
  columns: number,
  pageLines: Record<'is' | 'bs', readonly string[]>,
): ExtractionWarning[] {
  const notes: ExtractionWarning[] = []
  for (const line of column.lines) {
    if (line.value === null || line.value === 0) continue
    const printed = printedAmountsFor(line.rawLabel, pageLines[isIncomeStatementSection(line.section) ? 'is' : 'bs'], columns)
    const value = printed?.[index]
    if (value == null || Math.abs(Math.abs(value) - Math.abs(line.value)) >= 0.5 || Math.sign(value) === Math.sign(line.value)) continue

    const before = line.value
    line.value = value
    // A total the model filed straight from this line takes the sign too.
    const loc = locate(column, line.canonicalKey, false)
    if (loc && typeof loc.object[loc.key] === 'number' && Math.abs((loc.object[loc.key] as number) - before) < 0.5) {
      loc.object[loc.key] = value
    }
    notes.push({
      kind: 'sign_corrected',
      section: isIncomeStatementSection(line.section) ? 'incomeStatement' : 'balanceSheet',
      message: `"${line.rawLabel}" is printed as a negative (${money(value)}); its sign was corrected.`,
    })
  }
  return notes
}

// ─── Per column, per file ─────────────────────────────────────────────────────

function categoryLabel(key: string): string {
  return readableKey(key.split('.')[0] ?? key)
}

/** Notes made from the lines themselves, the same for every year and column. */
function lineNotes(lines: StatementLine[], ctx: CorrectionContext): ExtractionWarning[] {
  const notes: ExtractionWarning[] = []
  for (const line of lines) {
    if (line.isTotal || line.value === null) continue
    const ek = effectiveKey(line, ctx)
    const section = isIncomeStatementSection(line.section) ? 'incomeStatement' : 'balanceSheet'
    if (ek.loan === 'unconfirmed') {
      notes.push({
        kind: 'loan_unconfirmed',
        section,
        message: `Loan '${line.rawLabel}': director or lender? Confirm. It is shown under loans & finance until confirmed.`,
      })
    } else if ((ek.source === 'model' || ek.source === 'fallback') && ek.key?.includes('.other.')) {
      notes.push({
        kind: 'unmapped_line_item',
        section,
        message: `"${line.rawLabel}" is not one of the standard lines; it is kept under other ${categoryLabel(ek.key)}.`,
      })
    }
  }
  return notes
}

/** One column, without the other column of its file to compare against. */
export function correctColumn(s: Statements, lines: StatementLine[], ctx: CorrectionContext): ExtractionWarning[] {
  return correctOne({ ...s, lines }, null, ctx, s)
}

function correctOne(column: Column, other: Column | null, ctx: CorrectionContext, target: Statements): ExtractionWarning[] {
  const notes: ExtractionWarning[] = []
  const lines = column.lines

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
    // Lines that do not add up: keep the model's figures, moving only lines
    // whose place is certain (dictionary and loan rule).
    notes.push({
      kind: 'lines_incomplete',
      section: half === 'is' ? 'incomeStatement' : 'balanceSheet',
      message: `The ${label} line items did not add up to its printed totals, so the extracted figures were kept as read.`,
    })
    for (const line of lines) {
      if (line.isTotal || !(half === 'is' ? IS_LINE_SECTIONS : BS_LINE_SECTIONS).includes(line.section)) continue
      const ek = effectiveKey(line, ctx)
      if ((ek.source === 'dictionary' || ek.source === 'loan') && ek.key) moveLine(target, line, ek.key)
    }
  }

  // Appropriation and profit-subtotal lines, wherever they sit.
  for (const line of lines) {
    const key = dictionaryKey(line.rawLabel, line.section)
    if (key && (key.startsWith('appropriations.') || key.startsWith('ignore.'))) moveLine(target, line, key)
  }

  const cogs = target.incomeStatement.cogs as Record<string, number | null | undefined>
  if (typeof cogs.closingStock === 'number') cogs.closingStock = Math.abs(cogs.closingStock)

  notes.push(...lineNotes(lines, ctx))
  notes.push(...correctProfit(target, lines, ctx))
  return notes
}

export interface FileColumn extends Column {
  /** 0 for the primary (or only) column, 1 for the comparative. */
  index: number
}

/**
 * Every column of one file, the same way. `pageLines` is our own text of the
 * file's statement pages, for the printed-sign check. Returns each column's
 * notes, and the file's own notes.
 */
export function correctFile(
  columns: FileColumn[],
  ctx: CorrectionContext,
  pageLines: Record<'is' | 'bs', readonly string[]> | null,
): { columnNotes: ExtractionWarning[][]; fileNotes: ExtractionWarning[] } {
  const columnNotes = columns.map(() => [] as ExtractionWarning[])
  const fileNotes: ExtractionWarning[] = []

  if (pageLines) {
    columns.forEach((column, i) => columnNotes[i].push(...applyPrintedSigns(column, column.index, columns.length, pageLines)))
  }

  // Totals printed in the wrong column are put right before anything is
  // checked against them.
  if (columns.length === 2 && fixSwappedTotals(columns[0], columns[1])) {
    fileNotes.push({
      kind: 'swapped_totals',
      message: 'Totals in this file appear to be printed in the wrong column; figures were taken from the line items.',
    })
  }

  columns.forEach((column, i) => {
    const other = columns.length === 2 ? columns[1 - i] : null
    columnNotes[i].push(...correctOne(column, other, ctx, column))
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
      const mine = sectionSum(own.lines, section)
      const theirs = sectionSum(other.lines, section)
      if (printed === null || mine === null || theirs === null) continue
      if (Math.abs(printed - mine) <= LINE_TOLERANCE) continue
      if (Math.abs(printed - theirs) > LINE_TOLERANCE) continue
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
