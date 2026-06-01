import type {
  AtoLiabilityKey,
  BalanceSheetCategory,
  BalanceSheetLineKey,
  BalanceSheetTotalKey,
  IncomeStatementCategory,
  IncomeStatementLineKey,
  IncomeStatementTotalKey,
} from './schema'

// ─── Extraction shape (per single PDF) ────────────────────────────────────────

/** Value parsed from a single line item. `null` means the line was absent
 *  from the PDF for that period (presented as `-` or empty). */
export type LineValue = number | null

export type IncomeStatementLines = {
  [C in IncomeStatementCategory]: Partial<Record<IncomeStatementLineKey<C>, LineValue>>
}
export type IncomeStatementTotals = Partial<Record<IncomeStatementTotalKey, LineValue>>

export interface ExtractedIncomeStatement {
  income: IncomeStatementLines['income']
  cogs: IncomeStatementLines['cogs']
  expenses: IncomeStatementLines['expenses']
  totals: IncomeStatementTotals
}

export type BalanceSheetLines = {
  [C in BalanceSheetCategory]: Partial<Record<BalanceSheetLineKey<C>, LineValue>>
}
export type BalanceSheetTotals = Partial<Record<BalanceSheetTotalKey, LineValue>>

export interface ExtractedBalanceSheet {
  currentAssets: BalanceSheetLines['currentAssets']
  nonCurrentAssets: BalanceSheetLines['nonCurrentAssets']
  currentLiabilities: BalanceSheetLines['currentLiabilities']
  nonCurrentLiabilities: BalanceSheetLines['nonCurrentLiabilities']
  equity: BalanceSheetLines['equity']
  totals: BalanceSheetTotals
}

export interface ExtractionWarning {
  kind:
    | 'unmapped_line_item'
    | 'totals_reconciliation'
    | 'unparseable_value'
    | 'missing_total'
    | 'incomplete_current_period'
  message: string
  rawLabel?: string
  rawValue?: string
  section?: string
}

export interface RawExtractionEntry {
  section: string             // e.g. "Income > Other Revenue"
  rawLabel: string
  rawValue: string
  canonicalKey?: string       // populated when the mapper recognised it
}

/** Which column of the source PDF a row came from. Xero comparatives present
 *  the current FY in the left column ("primary") and the prior FY in the right
 *  ("comparative"). When the same FY shows up as primary in one PDF and as
 *  comparative in another, the primary extraction wins.
 *
 *  `current_period` is used for non-accountant-prepared partial-period PDFs
 *  exported from accounting software (Xero/MYOB/QuickBooks). These have a
 *  single column of values covering a partial FY (e.g. 1 Jul 2025 to 4 May
 *  2026) and live in a separate slot from the annual primary/comparative. */
export type FinancialStatementSourceColumn = 'primary' | 'comparative' | 'current_period'

export interface ExtractedFinancialStatement {
  financialYear: number       // 2025 for "year ended 30 June 2025"
  periodEndDate: string       // ISO date — '2025-06-30'
  sourceFilename: string
  sourceColumn: FinancialStatementSourceColumn
  incomeStatement: ExtractedIncomeStatement
  balanceSheet: ExtractedBalanceSheet
  rawExtraction: RawExtractionEntry[]
  warnings: ExtractionWarning[]
  extractionModel?: string
  /** For 'current_period' rows only: the human-readable date range covered.
   *  e.g. "1 July 2025 to 4 May 2026". Used by the UI to label the column. */
  periodLabel?: string
  /** For 'current_period' rows only: the ISO start date of the period. */
  periodStartDate?: string
}

// ─── Comparison output shape ─────────────────────────────────────────────────

export type Severity = 'good' | 'watch' | 'concern'
export type Direction = 'up' | 'down' | 'flat'

export interface HeadlineMetric {
  key: HeadlineKey
  label: string
  latestValue: number | null
  formatted: string
  /** 4-year (or fewer) trend, in FY-ascending order. `null` for missing years.
   *  Always the ANNUAL series only — never includes the current-period value
   *  (mixing partial period data into the trend would distort severities). */
  trend: Array<number | null>
  yoyPercent: number | null
  /** Absolute change between oldest and latest present value. */
  absoluteChange: number | null
  severity: Severity
  direction: Direction
  /** Current partial-period value for the same metric, when a current-period
   *  statement is present. Surfaced under the tile as informational only —
   *  excluded from severity, sparkline, and YoY logic. */
  currentPeriodValue?: number | null
}

export type HeadlineKey =
  | 'revenue'
  | 'netProfit'
  | 'netAssets'
  | 'atoDebtTrajectory'
  | 'directorLoansReceivable'

export interface YearRatios {
  grossMarginPercent: number | null
  atoDebtAsPercentOfRevenue: number | null
  atoDebtAsPercentOfTotalLiabilities: number | null
  directorLoansAsPercentOfAssets: number | null
  currentRatio: number | null
  debtToAssetRatio: number | null
  daysRevenueInAtoDebt: number | null
  /** Signed: positive when net assets > 0 (solvent). */
  netAssetsToTotalLiabilities: number | null
}

export interface DiffRow {
  canonicalKey: string
  label: string
  valuesByYear: Record<number, number | null>
  yoyPercentByYear: Record<number, number | null>
  absoluteChangeOldestToLatest: number | null
  direction: Direction
  /** Partial-period value for the same line, populated when a current-period
   *  statement is present. Not included in YoY/trend math. */
  currentPeriodValue?: number | null
}

export interface DiffTableSection {
  category: string             // e.g. "Income", "Current Assets"
  rows: DiffRow[]
}

/** Aggregated total of {@link AtoLiabilityKey} lines for a single year.
 *  Surfaced separately because the UI displays this as a highlighted block. */
export interface AtoLiabilityAggregate {
  byKey: Partial<Record<AtoLiabilityKey, number | null>>
  total: number
}

export interface CurrentPeriodSnapshot {
  /** Verbatim human-readable range from the source PDF, e.g.
   *  "1 July 2025 to 4 May 2026". */
  periodLabel: string
  periodStartDate: string        // ISO
  periodEndDate: string          // ISO
  /** FY in which periodEndDate falls (AU FY July–June). */
  financialYear: number
  /** Sum of ATO-related current-liability lines for the partial period. */
  atoLiabilityTotal: number
}

export interface FinancialsComparison {
  years: number[]                                     // FY-ascending (annual only)
  periodRange: { start: string; end: string }         // ISO dates (annual coverage)
  headlines: Record<HeadlineKey, HeadlineMetric>
  ratiosByYear: Record<number, YearRatios>
  atoLiabilityByYear: Record<number, AtoLiabilityAggregate>
  incomeStatementDiffs: DiffTableSection[]
  balanceSheetDiffs: DiffTableSection[]
  /** Sum of profitBeforeTax across all years present (used by the AI prompt). */
  cumulativeProfitBeforeTax: number
  /** Optional partial-period snapshot from a current_financials PDF. Surfaced
   *  as a 5th column in the UI but excluded from sparklines, YoY math, and
   *  severity classification. */
  currentPeriod?: CurrentPeriodSnapshot
}
