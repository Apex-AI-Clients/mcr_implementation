import { dictionaryKey, isIncomeTaxExpenseLabel, isPriorYearLossLabel, normaliseLabel } from './labels'
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
function otherEntryFor(s: Statements, line: StatementLine): Location | null {
  const sectionKey = line.section === 'otherIncome' ? 'income' : line.section
  const loc = locate(s, `${sectionKey}.other.${line.rawLabel}`, false)
  return loc && typeof loc.object[loc.key] === 'number' ? loc : null
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
export function correctColumn(
  s: Statements,
  lines: StatementLine[],
  { isTrust }: { isTrust: boolean },
): ExtractionWarning[] {
  const notes: ExtractionWarning[] = []

  // 1 + 3. The dictionary, appropriations included.
  for (const line of lines) {
    if (line.isTotal && !/^ignore\./.test(dictionaryKey(line.rawLabel, line.section) ?? '')) continue
    const wanted = dictionaryKey(line.rawLabel, line.section)
    if (!wanted) continue
    const before = line.canonicalKey
    if (moveLine(s, line, wanted) && !wanted.startsWith('appropriations.') && !wanted.startsWith('ignore.')) {
      notes.push({
        kind: 'mapping_corrected',
        section: isIncomeStatementSection(line.section) ? 'incomeStatement' : 'balanceSheet',
        message: `"${line.rawLabel}" was moved to ${readableKey(wanted)} (it had been read as ${readableKey(before)}).`,
      })
    }
  }

  // 2. Closing stock is subtracted, so it is stored positive.
  const cogs = s.incomeStatement.cogs as Record<string, number | null | undefined>
  if (typeof cogs.closingStock === 'number') cogs.closingStock = Math.abs(cogs.closingStock)

  notes.push(...correctProfit(s, lines, { isTrust }))
  return notes
}

/**
 * 4. Profit. Run on every column at extraction, and again on stored
 * statements when the comparison is built (where, without lines, only the
 * trust rule applies).
 */
export function correctProfit(
  s: Statements,
  lines: StatementLine[],
  { isTrust }: { isTrust: boolean },
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
