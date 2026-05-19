import {
  ATO_LIABILITY_KEYS,
  BALANCE_SHEET_SCHEMA,
  INCOME_STATEMENT_SCHEMA,
  type AtoLiabilityKey,
} from './schema'
import type {
  AtoLiabilityAggregate,
  DiffRow,
  DiffTableSection,
  Direction,
  ExtractedFinancialStatement,
  FinancialsComparison,
  HeadlineKey,
  HeadlineMetric,
  Severity,
  YearRatios,
} from './types'

// ─── Helpers ─────────────────────────────────────────────────────────────────

const AUD = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  maximumFractionDigits: 0,
})

function fmtAud(v: number | null): string {
  if (v === null) return '—'
  return AUD.format(v)
}

function yoyPercent(prev: number | null, curr: number | null): number | null {
  if (prev === null || curr === null) return null
  if (prev === 0) return null
  return ((curr - prev) / Math.abs(prev)) * 100
}

function direction(values: Array<number | null>): Direction {
  const present = values.filter((v): v is number => v !== null)
  if (present.length < 2) return 'flat'
  const first = present[0]
  const last = present[present.length - 1]
  const delta = last - first
  if (Math.abs(delta) < 1) return 'flat'
  return delta > 0 ? 'up' : 'down'
}

function safeDiv(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null) return null
  if (denominator === 0) return null
  return numerator / denominator
}

// ─── Per-year aggregates ─────────────────────────────────────────────────────

function sumAtoLiabilities(s: ExtractedFinancialStatement): AtoLiabilityAggregate {
  const byKey: Partial<Record<AtoLiabilityKey, number | null>> = {}
  let total = 0
  for (const k of ATO_LIABILITY_KEYS) {
    const v = s.balanceSheet.currentLiabilities[k] ?? null
    byKey[k] = v
    if (v !== null) total += v
  }
  return { byKey, total }
}

function totalIncome(s: ExtractedFinancialStatement): number | null {
  return s.incomeStatement.totals.totalIncome ?? null
}
function sales(s: ExtractedFinancialStatement): number | null {
  return s.incomeStatement.income.sales ?? null
}
function totalAssets(s: ExtractedFinancialStatement): number | null {
  return s.balanceSheet.totals.totalAssets ?? null
}
function totalLiabilities(s: ExtractedFinancialStatement): number | null {
  return s.balanceSheet.totals.totalLiabilities ?? null
}
function totalCurrentAssets(s: ExtractedFinancialStatement): number | null {
  return s.balanceSheet.totals.totalCurrentAssets ?? null
}
function totalCurrentLiabilities(s: ExtractedFinancialStatement): number | null {
  return s.balanceSheet.totals.totalCurrentLiabilities ?? null
}
function netAssets(s: ExtractedFinancialStatement): number | null {
  return s.balanceSheet.totals.netAssets ?? null
}
function profitBeforeTax(s: ExtractedFinancialStatement): number | null {
  return s.incomeStatement.totals.profitBeforeTax ?? null
}
function totalCogs(s: ExtractedFinancialStatement): number | null {
  return s.incomeStatement.totals.totalCogs ?? null
}
function directorLoansReceivable(s: ExtractedFinancialStatement): number | null {
  return s.balanceSheet.nonCurrentAssets.directorRelatedLoansReceivable ?? null
}

function computeRatios(s: ExtractedFinancialStatement): YearRatios {
  const income = totalIncome(s)
  const cogs = totalCogs(s)
  const ato = sumAtoLiabilities(s).total
  const liab = totalLiabilities(s)
  const assets = totalAssets(s)
  const dirLoans = directorLoansReceivable(s)
  const curAssets = totalCurrentAssets(s)
  const curLiab = totalCurrentLiabilities(s)
  const sale = sales(s)
  const equity = netAssets(s)

  const grossMargin =
    income !== null && cogs !== null && income !== 0
      ? ((income - cogs) / income) * 100
      : null

  return {
    grossMarginPercent: grossMargin,
    atoDebtAsPercentOfRevenue: sale !== null && sale !== 0 ? (ato / sale) * 100 : null,
    atoDebtAsPercentOfTotalLiabilities:
      liab !== null && liab !== 0 ? (ato / liab) * 100 : null,
    directorLoansAsPercentOfAssets:
      dirLoans !== null && assets !== null && assets !== 0
        ? (dirLoans / assets) * 100
        : null,
    currentRatio: safeDiv(curAssets, curLiab),
    debtToAssetRatio: safeDiv(liab, assets),
    daysRevenueInAtoDebt: sale !== null && sale !== 0 ? (ato / sale) * 365 : null,
    netAssetsToTotalLiabilities: safeDiv(equity, liab),
  }
}

// ─── Headline severity rules ─────────────────────────────────────────────────

function revenueSeverity(latest: number | null, prev: number | null): Severity {
  const yoy = yoyPercent(prev, latest)
  if (yoy === null) return 'good'
  if (yoy < -10) return 'concern'
  if (yoy < 0) return 'watch'
  return 'good'
}

function netProfitSeverity(latest: number | null): Severity {
  if (latest === null) return 'watch'
  if (latest >= 0) return 'good'
  if (latest > -5000) return 'watch'
  return 'concern'
}

function netAssetsSeverity(latest: number | null): Severity {
  if (latest === null) return 'watch'
  if (latest > 0) return 'good'
  if (latest >= -50000) return 'watch'
  return 'concern'
}

function atoTrajectorySeverity(
  atoTrend: Array<number | null>,
  revenueTrend: Array<number | null>,
): Severity {
  const atoPresent = atoTrend.filter((v): v is number => v !== null)
  const revPresent = revenueTrend.filter((v): v is number => v !== null)
  if (atoPresent.length < 2 || revPresent.length < 2) return 'watch'

  const atoFirst = atoPresent[0]
  const atoLast = atoPresent[atoPresent.length - 1]
  const revFirst = revPresent[0]
  const revLast = revPresent[revPresent.length - 1]

  const atoGrowth = atoFirst === 0 ? Infinity : (atoLast - atoFirst) / Math.abs(atoFirst)
  const revGrowth = revFirst === 0 ? 0 : (revLast - revFirst) / Math.abs(revFirst)

  if (atoLast <= atoFirst) return 'good'
  if (atoGrowth > revGrowth) return 'concern'
  return 'watch'
}

function directorLoansSeverity(
  latestValue: number | null,
  latestTotalAssets: number | null,
  prevValue: number | null,
): Severity {
  if (latestValue === null || latestValue === 0) return 'good'
  if (latestTotalAssets !== null && latestTotalAssets > 0) {
    const pctOfAssets = (latestValue / latestTotalAssets) * 100
    if (pctOfAssets >= 10) return 'concern'
    if (prevValue !== null && latestValue - prevValue > 20000) return 'concern'
    if (pctOfAssets > 0) return 'watch'
  }
  if (prevValue !== null && latestValue < prevValue) return 'good'
  return 'watch'
}

// ─── Diff tables ─────────────────────────────────────────────────────────────

function buildDiffTable(
  category: string,
  schemaSection: Record<string, string>,
  years: number[],
  pick: (s: ExtractedFinancialStatement, key: string) => number | null,
  byYear: Record<number, ExtractedFinancialStatement>,
): DiffTableSection {
  const rows: DiffRow[] = []
  for (const [canonicalKey, label] of Object.entries(schemaSection)) {
    const valuesByYear: Record<number, number | null> = {}
    let allZeroOrNull = true
    for (const fy of years) {
      const v = pick(byYear[fy], canonicalKey)
      valuesByYear[fy] = v
      if (v !== null && v !== 0) allZeroOrNull = false
    }
    if (allZeroOrNull) continue

    const yoyByYear: Record<number, number | null> = {}
    for (let i = 0; i < years.length; i++) {
      const fy = years[i]
      yoyByYear[fy] = i === 0 ? null : yoyPercent(valuesByYear[years[i - 1]], valuesByYear[fy])
    }

    const trend = years.map((fy) => valuesByYear[fy])
    const present = trend.filter((v): v is number => v !== null)
    const absoluteChange =
      present.length >= 2 ? present[present.length - 1] - present[0] : null

    rows.push({
      canonicalKey,
      label,
      valuesByYear,
      yoyPercentByYear: yoyByYear,
      absoluteChangeOldestToLatest: absoluteChange,
      direction: direction(trend),
    })
  }
  return { category, rows }
}

function pickIncomeLine(
  section: 'income' | 'cogs' | 'expenses',
  s: ExtractedFinancialStatement,
  key: string,
): number | null {
  const sec = s.incomeStatement[section] as Record<string, number | null | undefined>
  return sec[key] ?? null
}
function pickIncomeTotal(s: ExtractedFinancialStatement, key: string): number | null {
  const t = s.incomeStatement.totals as Record<string, number | null | undefined>
  return t[key] ?? null
}
function pickBalanceLine(
  section:
    | 'currentAssets'
    | 'nonCurrentAssets'
    | 'currentLiabilities'
    | 'nonCurrentLiabilities'
    | 'equity',
  s: ExtractedFinancialStatement,
  key: string,
): number | null {
  const sec = s.balanceSheet[section] as Record<string, number | null | undefined>
  return sec[key] ?? null
}
function pickBalanceTotal(s: ExtractedFinancialStatement, key: string): number | null {
  const t = s.balanceSheet.totals as Record<string, number | null | undefined>
  return t[key] ?? null
}

// ─── Main entry point ────────────────────────────────────────────────────────

/**
 * Pure function. Takes 1–4 extracted annual financial statements (in any order)
 * and produces the comparison payload rendered on the financials-comparison page.
 */
export function computeFinancialsComparison(
  statements: ExtractedFinancialStatement[],
): FinancialsComparison {
  if (statements.length === 0) {
    throw new Error('computeFinancialsComparison: at least one statement is required.')
  }

  const sorted = [...statements].sort((a, b) => a.financialYear - b.financialYear)
  const years = sorted.map((s) => s.financialYear)
  const byYear: Record<number, ExtractedFinancialStatement> = {}
  for (const s of sorted) byYear[s.financialYear] = s

  // Ratios and ATO liability aggregates per year
  const ratiosByYear: Record<number, YearRatios> = {}
  const atoLiabilityByYear: Record<number, AtoLiabilityAggregate> = {}
  for (const fy of years) {
    ratiosByYear[fy] = computeRatios(byYear[fy])
    atoLiabilityByYear[fy] = sumAtoLiabilities(byYear[fy])
  }

  // Trend series for the headline tiles
  const revenueTrend = years.map((fy) => sales(byYear[fy]))
  const netProfitTrend = years.map((fy) => profitBeforeTax(byYear[fy]))
  const netAssetsTrend = years.map((fy) => netAssets(byYear[fy]))
  const atoTrend = years.map((fy) => atoLiabilityByYear[fy].total)
  const dirLoansTrend = years.map((fy) => directorLoansReceivable(byYear[fy]))

  function lastPresent(values: Array<number | null>): number | null {
    for (let i = values.length - 1; i >= 0; i--) {
      if (values[i] !== null) return values[i]
    }
    return null
  }

  function buildHeadline(
    key: HeadlineKey,
    label: string,
    trend: Array<number | null>,
    severity: Severity,
  ): HeadlineMetric {
    const latestValue = lastPresent(trend)
    const present = trend.filter((v): v is number => v !== null)
    const prev = present.length >= 2 ? present[present.length - 2] : null
    const yoy = yoyPercent(prev, latestValue)
    const absoluteChange = present.length >= 2 ? present[present.length - 1] - present[0] : null

    return {
      key,
      label,
      latestValue,
      formatted: fmtAud(latestValue),
      trend,
      yoyPercent: yoy,
      absoluteChange,
      severity,
      direction: direction(trend),
    }
  }

  const latestRevenue = lastPresent(revenueTrend)
  const prevRevenue =
    revenueTrend.length >= 2 ? revenueTrend[revenueTrend.length - 2] : null
  const latestNetProfit = lastPresent(netProfitTrend)
  const latestNetAssets = lastPresent(netAssetsTrend)
  const latestDirLoans = lastPresent(dirLoansTrend)
  const prevDirLoans =
    dirLoansTrend.length >= 2 ? dirLoansTrend[dirLoansTrend.length - 2] : null
  const latestTotalAssets = totalAssets(byYear[years[years.length - 1]])

  const headlines: Record<HeadlineKey, HeadlineMetric> = {
    revenue: buildHeadline(
      'revenue',
      'Revenue',
      revenueTrend,
      revenueSeverity(latestRevenue, prevRevenue),
    ),
    netProfit: buildHeadline(
      'netProfit',
      'Net Profit / (Loss)',
      netProfitTrend,
      netProfitSeverity(latestNetProfit),
    ),
    netAssets: buildHeadline(
      'netAssets',
      'Net Assets',
      netAssetsTrend,
      netAssetsSeverity(latestNetAssets),
    ),
    atoDebtTrajectory: buildHeadline(
      'atoDebtTrajectory',
      'ATO Debt Trajectory',
      atoTrend,
      atoTrajectorySeverity(atoTrend, revenueTrend),
    ),
    directorLoansReceivable: buildHeadline(
      'directorLoansReceivable',
      'Director Loans Receivable',
      dirLoansTrend,
      directorLoansSeverity(latestDirLoans, latestTotalAssets, prevDirLoans),
    ),
  }

  // Diff tables — income statement (line items + totals)
  const incomeStatementDiffs: DiffTableSection[] = [
    buildDiffTable(
      'Income',
      omitOther(INCOME_STATEMENT_SCHEMA.income),
      years,
      (s, k) => pickIncomeLine('income', s, k),
      byYear,
    ),
    buildDiffTable(
      'Cost of Goods Sold',
      omitOther(INCOME_STATEMENT_SCHEMA.cogs),
      years,
      (s, k) => pickIncomeLine('cogs', s, k),
      byYear,
    ),
    buildDiffTable(
      'Expenses',
      omitOther(INCOME_STATEMENT_SCHEMA.expenses),
      years,
      (s, k) => pickIncomeLine('expenses', s, k),
      byYear,
    ),
    buildDiffTable('Totals', INCOME_STATEMENT_SCHEMA.totals, years, pickIncomeTotal, byYear),
  ]

  // Diff tables — balance sheet
  const balanceSheetDiffs: DiffTableSection[] = [
    buildDiffTable(
      'Current Assets',
      omitOther(BALANCE_SHEET_SCHEMA.currentAssets),
      years,
      (s, k) => pickBalanceLine('currentAssets', s, k),
      byYear,
    ),
    buildDiffTable(
      'Non-Current Assets',
      omitOther(BALANCE_SHEET_SCHEMA.nonCurrentAssets),
      years,
      (s, k) => pickBalanceLine('nonCurrentAssets', s, k),
      byYear,
    ),
    buildDiffTable(
      'Current Liabilities',
      omitOther(BALANCE_SHEET_SCHEMA.currentLiabilities),
      years,
      (s, k) => pickBalanceLine('currentLiabilities', s, k),
      byYear,
    ),
    buildDiffTable(
      'Non-Current Liabilities',
      omitOther(BALANCE_SHEET_SCHEMA.nonCurrentLiabilities),
      years,
      (s, k) => pickBalanceLine('nonCurrentLiabilities', s, k),
      byYear,
    ),
    buildDiffTable(
      'Equity',
      omitOther(BALANCE_SHEET_SCHEMA.equity),
      years,
      (s, k) => pickBalanceLine('equity', s, k),
      byYear,
    ),
    buildDiffTable('Totals', BALANCE_SHEET_SCHEMA.totals, years, pickBalanceTotal, byYear),
  ]

  const cumulativeProfitBeforeTax = sorted.reduce(
    (sum, s) => sum + (s.incomeStatement.totals.profitBeforeTax ?? 0),
    0,
  )

  return {
    years,
    periodRange: {
      start: sorted[0].periodEndDate,
      end: sorted[sorted.length - 1].periodEndDate,
    },
    headlines,
    ratiosByYear,
    atoLiabilityByYear,
    incomeStatementDiffs,
    balanceSheetDiffs,
    cumulativeProfitBeforeTax,
  }
}

/** Drops the `other` uncategorised bucket from diff tables — it always renders
 *  noise. The raw "other" values are still available in `raw_extraction` for audit. */
function omitOther(section: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(section)) {
    if (k === 'other') continue
    out[k] = v
  }
  return out
}
