import type { DiffRow, FinancialsComparison } from '@/lib/financials/types'

/**
 * "What the financial statements show": plain-English points for staff to
 * discuss with the client, built by rules from the verified comparison. Pure;
 * no AI text.
 *
 * Thresholds decide only WHETHER a point is shown. A point, once shown,
 * states the facts in full — every loss year and the true total, the real
 * figures at each end — never a figure a threshold has filtered.
 *
 * Facts only: no legal conclusions, no advice. "ATO-related debt" here is the
 * ATO account, GST and PAYG withholding, EXCLUDING super (owed to super
 * funds, not the ATO), as creditorDebt.ts counts it — every sentence says so.
 * The comparison page's ATO card includes super; a note there says so.
 *
 * The recommended % comes from similar past cases, which don't include these
 * figures: these points explain the situation, they don't change the %.
 */

export type PointRule = 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h'

export interface FinancialPoint {
  rule: PointRule
  text: string
}

export const FINANCIAL_POINTS_INTRO =
  "Points to discuss with the client, from the financial statements. The recommended % comes from similar past SBR cases, which don't include these figures, so these points explain the situation but don't change the %."

export const FINANCIAL_POINTS_NOT_READY = 'Financial points will appear once the financial comparison is verified.'

/** Shown first to last; at most MAX_POINTS. */
const ORDER: PointRule[] = ['b', 'a', 'c', 'd', 'e', 'f', 'g', 'h']
export const MAX_POINTS = 6

/** A change is material at $10,000 or more AND 20% or more (from $0, any $10,000). */
export const MATERIAL_DOLLARS = 10_000
export const MATERIAL_SHARE = 0.2
/** Revenue counts as flat when it grew by no more than this. */
export const FLAT_REVENUE_GROWTH = 0.05
/** Losses show when they add up to this much, or the latest year is a loss of LATEST_LOSS after a profit. */
export const MATERIAL_TOTAL_LOSS = 10_000
export const MATERIAL_LATEST_LOSS = 5_000

const ATO = 'ATO-related debt (ATO account, GST and PAYG withholding; excluding super)'
/** The ATO-related keys the points add up (super is owed to super funds, not the ATO). */
export const ATO_EXCLUDING_SUPER_KEYS = ['atoLiability', 'gstPayable', 'paygWithholdingPayable']
const ATO_KEYS = ATO_EXCLUDING_SUPER_KEYS

export function isMaterial(from: number, to: number): boolean {
  const change = Math.abs(to - from)
  if (change < MATERIAL_DOLLARS) return false
  return from === 0 || change / Math.abs(from) >= MATERIAL_SHARE
}

/** "$1,234" or "-$1,234", whole dollars. */
export function money(n: number): string {
  const whole = Math.round(n)
  return `${whole < 0 ? '-' : ''}$${Math.abs(whole).toLocaleString('en-AU')}`
}

function listYears(years: number[]): string {
  const labels = years.map((y) => `FY${y}`)
  return labels.length <= 1 ? labels.join('') : `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`
}

const SHORT_DATE = new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

interface Point {
  label: string
  value: number
}

interface Series {
  /** Compared years with a figure, ascending. */
  years: Point[]
  /** The current period's figure (balance sheet items only), if any. */
  current: Point | null
}

function rowsByKey(c: FinancialsComparison): Map<string, DiffRow> {
  const map = new Map<string, DiffRow>()
  for (const section of [...c.incomeStatementDiffs, ...c.balanceSheetDiffs]) {
    for (const row of section.rows) if (!map.has(row.canonicalKey)) map.set(row.canonicalKey, row)
  }
  return map
}

/**
 * The sum of these lines per compared year (null when none of them has a
 * figure that year), plus the current period for balance-sheet items: a
 * point in time, unlike a part-year profit and loss.
 */
function series(c: FinancialsComparison, rows: Map<string, DiffRow>, keys: string[], withCurrent: boolean): Series {
  const years: Point[] = []
  for (const fy of c.years) {
    let sum: number | null = null
    for (const key of keys) {
      const v = rows.get(key)?.valuesByYear[fy]
      if (v != null) sum = (sum ?? 0) + v
    }
    if (sum !== null) years.push({ label: `FY${fy}`, value: sum })
  }
  let current: Point | null = null
  if (withCurrent && c.currentPeriod) {
    let sum: number | null = null
    for (const key of keys) {
      const v = rows.get(key)?.currentPeriodValue
      if (v != null) sum = (sum ?? 0) + v
    }
    if (sum !== null) {
      current = { label: `${SHORT_DATE.format(new Date(c.currentPeriod.periodEndDate))} (current period)`, value: sum }
    }
  }
  return { years, current }
}

const firstOf = (s: Series) => s.years[0] ?? null
const lastOf = (s: Series) => s.years.at(-1) ?? null

/** "was $X at 30 Sep 2026 (current period)", appended to a balance-sheet point. */
function currentTail(s: Series, verb = 'was'): string {
  return s.current ? `, and ${verb} ${money(s.current.value)} at ${s.current.label}` : ''
}

/** Rose materially from the first compared year to the last. */
function roseMaterially(s: Series): boolean {
  const a = firstOf(s)
  const b = lastOf(s)
  return a !== null && b !== null && b !== a && b.value > a.value && isMaterial(a.value, b.value)
}

export interface FinancialPointsInput {
  comparison: FinancialsComparison
  /** From company_details: "the company", "the trust", else "the business". */
  entityType: string | null
}

export function financialPoints({ comparison: c, entityType }: FinancialPointsInput): FinancialPoint[] {
  const rows = rowsByKey(c)
  const entity = entityType === 'company' ? 'The company' : entityType === 'trust' ? 'The trust' : 'The business'
  const points = new Map<PointRule, string>()

  const ato = series(c, rows, ATO_KEYS, true)
  const atoFrom = firstOf(ato)
  const atoTo = lastOf(ato)
  const atoRose = roseMaterially(ato)
  const atoChange = atoRose ? ` while ${ATO} rose from ${money(atoFrom!.value)} to ${money(atoTo!.value)}` : ''

  // (a) ATO-related debt: always.
  if (!atoFrom && !ato.current) {
    points.set('a', 'The balance sheets show no ATO-related debt (ATO account, GST or PAYG withholding; super is not counted here).')
  } else if (atoFrom && atoTo && atoTo !== atoFrom) {
    const verb = isMaterial(atoFrom.value, atoTo.value) ? (atoTo.value > atoFrom.value ? 'rose' : 'fell') : 'went'
    points.set('a', `${ATO} ${verb} from ${money(atoFrom.value)} (${atoFrom.label}) to ${money(atoTo.value)} (${atoTo.label})${currentTail(ato)}.`)
  } else {
    const when = atoTo ? `in ${atoTo.label}` : `at ${ato.current!.label}`
    points.set('a', `${ATO} was ${money((atoTo ?? ato.current!).value)} ${when}${atoTo ? currentTail(ato) : ''}.`)
  }

  // (b) Assets bought while ATO-related debt rose: plant & equipment, else
  // non-current assets other than loans to directors (those are point d).
  if (atoRose) {
    const ppe = series(c, rows, ['propertyPlantEquipment'], false)
    if (roseMaterially(ppe)) {
      points.set('b', `Property, plant & equipment rose from ${money(firstOf(ppe)!.value)} (${firstOf(ppe)!.label}) to ${money(lastOf(ppe)!.value)} (${lastOf(ppe)!.label})${atoChange}.`)
    } else {
      const nca = series(c, rows, ['totalNonCurrentAssets'], false)
      const loans = series(c, rows, ['directorRelatedLoansReceivable'], false)
      const net: Series = {
        years: nca.years.map((p) => ({
          label: p.label,
          value: p.value - (loans.years.find((l) => l.label === p.label)?.value ?? 0),
        })),
        current: null,
      }
      if (roseMaterially(net)) {
        points.set('b', `Non-current assets other than loans to directors rose from ${money(firstOf(net)!.value)} (${firstOf(net)!.label}) to ${money(lastOf(net)!.value)} (${lastOf(net)!.label})${atoChange}.`)
      }
    }
  }

  // (c) Loans owed to directors or related parties, growing.
  const owedTo = series(c, rows, ['directorRelatedLoansPayable'], true)
  if (roseMaterially(owedTo)) {
    points.set('c', `Loans owed to directors or related parties rose from ${money(firstOf(owedTo)!.value)} (${firstOf(owedTo)!.label}) to ${money(lastOf(owedTo)!.value)} (${lastOf(owedTo)!.label})${currentTail(owedTo, 'were')}.`)
  }

  // (d) Loans owed BY directors or related parties, growing.
  const owedBy = series(c, rows, ['directorRelatedLoansReceivable'], true)
  if (roseMaterially(owedBy)) {
    points.set('d', `Loans owed to the business by directors or related parties rose from ${money(firstOf(owedBy)!.value)} (${firstOf(owedBy)!.label}) to ${money(lastOf(owedBy)!.value)} (${lastOf(owedBy)!.label})${currentTail(owedBy, 'were')}.`)
  }

  // (e) Losses. The threshold decides whether to show; the sentence counts
  // every loss year and the true total.
  const profit = series(c, rows, ['profitBeforeTax'], false)
  const lossYears = profit.years.filter((p) => p.value < 0)
  const totalLoss = lossYears.reduce((sum, p) => sum + p.value, 0)
  const latest = lastOf(profit)
  const before = profit.years.at(-2) ?? null
  const turnedToLoss = latest !== null && before !== null && before.value >= 0 && latest.value <= -MATERIAL_LATEST_LOSS
  if (lossYears.length > 0 && (totalLoss <= -MATERIAL_TOTAL_LOSS || turnedToLoss)) {
    const years = lossYears.map((p) => Number(p.label.slice(2)))
    points.set(
      'e',
      `${entity} made a loss in ${lossYears.length} of the ${profit.years.length} years compared (${listYears(years)}), ${money(Math.abs(totalLoss))} in total${
        turnedToLoss ? `, including ${latest!.label} after a profit in ${before!.label}` : ''
      }.`,
    )
  }

  // (f) Net assets.
  const net = series(c, rows, ['netAssets'], true)
  const nFrom = firstOf(net)
  const nTo = lastOf(net)
  if (nFrom && nTo && nTo !== nFrom && (nTo.value < 0 || isMaterial(nFrom.value, nTo.value))) {
    // A deficit is said as one: "liabilities exceeded assets by $X".
    const position = (v: number) => (v < 0 ? `liabilities exceeded assets by ${money(-v)}` : `net assets were ${money(v)}`)
    const tail = net.current ? `; at ${net.current.label}, ${position(net.current.value)}` : ''
    if (nTo.value < 0) {
      points.set('f', `Liabilities exceeded assets by ${money(-nTo.value)} in ${nTo.label}; in ${nFrom.label} ${position(nFrom.value)}${tail}.`)
    } else {
      points.set('f', `Net assets ${nTo.value > nFrom.value ? 'rose' : 'fell'} from ${money(nFrom.value)} (${nFrom.label}) to ${money(nTo.value)} (${nTo.label})${tail}.`)
    }
  }

  // (g) Revenue flat or down while ATO-related debt rose.
  const revenue = series(c, rows, ['totalIncome'], false)
  const rFrom = firstOf(revenue)
  const rTo = lastOf(revenue)
  if (atoRose && rFrom && rTo && rTo !== rFrom && rTo.value <= rFrom.value * (1 + FLAT_REVENUE_GROWTH)) {
    points.set('g', `Revenue went from ${money(rFrom.value)} (${rFrom.label}) to ${money(rTo.value)} (${rTo.label})${atoChange}.`)
  }

  // (h) Wages and super rising while super and PAYG withholding owing rose.
  const pay = series(c, rows, ['wagesAndSalaries', 'superannuation'], false)
  const owing = series(c, rows, ['superannuationPayable', 'paygWithholdingPayable'], false)
  if (roseMaterially(pay) && roseMaterially(owing)) {
    points.set(
      'h',
      `Wages and super expense rose from ${money(firstOf(pay)!.value)} (${firstOf(pay)!.label}) to ${money(lastOf(pay)!.value)} (${lastOf(pay)!.label}) while super and PAYG withholding owing rose from ${money(firstOf(owing)!.value)} to ${money(lastOf(owing)!.value)}.`,
    )
  }

  return ORDER.filter((rule) => points.has(rule))
    .slice(0, MAX_POINTS)
    .map((rule) => ({ rule, text: points.get(rule)! }))
}

/** Words a point must never use: no legal conclusions. */
export const BANNED_WORDS = /\b(insolven\w*|solvent|fraud\w*|illegal\w*|breach\w*|phoenix\w*)\b/i
