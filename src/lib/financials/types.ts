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
 *  comparative in another, the primary extraction wins. */
export type FinancialStatementSourceColumn = 'primary' | 'comparative'

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
}

// ─── Comparison output shape ─────────────────────────────────────────────────

export type Severity = 'good' | 'watch' | 'concern'
export type Direction = 'up' | 'down' | 'flat'

export interface HeadlineMetric {
  key: HeadlineKey
  label: string
  latestValue: number | null
  formatted: string
  /** 4-year (or fewer) trend, in FY-ascending order. `null` for missing years. */
  trend: Array<number | null>
  yoyPercent: number | null
  /** Absolute change between oldest and latest present value. */
  absoluteChange: number | null
  severity: Severity
  direction: Direction
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

export interface FinancialsComparison {
  years: number[]                                     // FY-ascending
  periodRange: { start: string; end: string }         // ISO dates
  headlines: Record<HeadlineKey, HeadlineMetric>
  ratiosByYear: Record<number, YearRatios>
  atoLiabilityByYear: Record<number, AtoLiabilityAggregate>
  incomeStatementDiffs: DiffTableSection[]
  balanceSheetDiffs: DiffTableSection[]
  /** Sum of profitBeforeTax across all years present (used by the AI prompt). */
  cumulativeProfitBeforeTax: number
}
