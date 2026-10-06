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
  /**
   * Below the profit line: what was distributed or applied, not an expense.
   * Read by the retained-earnings roll-forward. Absent on older extractions.
   */
  appropriations?: Appropriations
  /** The printed lines this column was read from. Absent on older extractions. */
  lines?: StatementLine[]
}

export interface Appropriations {
  /** Distributions to beneficiaries (trusts). Positive. */
  distributions?: LineValue
  /** Dividends paid or provided (companies). Positive. */
  dividends?: LineValue
  /** Prior-year losses set against this year's profit. Positive. Not a distribution. */
  priorYearLossesApplied?: LineValue
}

/** The printed section a line sits under. */
export type LineSection =
  | 'income'
  | 'otherIncome'
  | 'cogs'
  | 'expenses'
  | 'incomeTax'
  | 'appropriation'
  | 'incomeTotals'
  | 'currentAssets'
  | 'nonCurrentAssets'
  | 'currentLiabilities'
  | 'nonCurrentLiabilities'
  | 'equity'
  | 'balanceTotals'

/** One printed line of one column, as read, with the key it was mapped to. */
export interface StatementLine {
  section: LineSection
  rawLabel: string
  value: number | null
  /** "section.key", e.g. "nonCurrentAssets.propertyPlantEquipment"; null if unmapped. */
  canonicalKey: string | null
  isTotal: boolean
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
  /** The printed lines this column was read from. Absent on older extractions. */
  lines?: StatementLine[]
}

export interface ExtractionWarning {
  kind:
    | 'unmapped_line_item'
    | 'totals_reconciliation'
    | 'unparseable_value'
    | 'missing_total'
    | 'incomplete_current_period'
    // Added with the per-half pipeline (Stage 3). Ours, never the model's.
    | 'year_mismatch'
    | 'presence_mismatch'
    | 'document_kind'
    | 'filename_year_conflict'
    | 'page_selection'
    | 'profit_corrected'
    | 'mapping_corrected'
    | 'swapped_totals'
    | 'sign_corrected'
    | 'value_corrected'
    | 'loan_unconfirmed'
    | 'lines_incomplete'
    | 'column_not_extracted'
  message: string
  rawLabel?: string
  rawValue?: string
  section?: string
  /** Notes of one sort are shown together as one collapsible line ("12 lines kept under other expenses"). */
  group?: string
  /** column_not_extracted: the column the headings show but the model did not return. */
  financialYear?: number
  sourceColumn?: FinancialStatementSourceColumn
  halves?: StatementHalfKey[]
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
  /**
   * Which halves this column really carries, after the pre-pass cross-check.
   * Absent on statements read back from storage, where a missing half is
   * already an empty section.
   */
  present?: Record<StatementHalfKey, boolean>
}

// ─── Stored statements, per half (migration 0026) ────────────────────────────

/** The two halves of a statement slot. Each can come from a different file. */
export type StatementHalfKey = 'income_statement' | 'balance_sheet'

/** One half of a stored slot, with the file it came from. */
export interface StoredHalf<T> {
  data: T
  /** Null only on a legacy row whose document has since gone. */
  documentId: string | null
  sourceFilename: string | null
  extractedAt: string | null
  warnings: ExtractionWarning[]
}

/**
 * One financial_statements row, read through toStoredSlot(). A half is null
 * when the slot does not have it — never a stub of nulls.
 */
export interface StoredStatementSlot {
  id: string
  financialYear: number
  periodEndDate: string
  periodStartDate: string | null
  periodLabel: string | null
  sourceColumn: FinancialStatementSourceColumn
  incomeStatement: StoredHalf<ExtractedIncomeStatement> | null
  balanceSheet: StoredHalf<ExtractedBalanceSheet> | null
  /** Warnings whose section names neither half. Shown against the whole slot. */
  slotWarnings: ExtractionWarning[]
  /**
   * Written whole, without per-half owners: by the code before 0026, or by it
   * after 0026 during the release window. Each half counts only if it holds
   * real data.
   */
  legacy: boolean
  extractionModel: string | null
}

// ─── Per-document extraction (migration 0026) ────────────────────────────────

/** What a financials document turned out to be, from its page headings. */
export type FinancialDocumentKind =
  | 'combined'
  | 'pnl_only'
  | 'bs_only'
  | 'tax_return_only'
  | 'not_financial'
  | 'unknown'

/** What a single page is, from its headings. */
export type FinancialPageClass =
  | 'income_statement'
  | 'balance_sheet'
  | 'tax_return'
  | 'notes_other'
  | 'cover'
  | 'unknown'

export interface FinancialPageEntry {
  /** 1-based physical page number in the file. */
  page: number
  class: FinancialPageClass
}

/** The entity a statement heading names, for the entity check. */
export interface HeadingEntity {
  /** The heading line as printed, e.g. "SAMPLE PTY LTD ATF SAMPLE FAMILY TRUST". */
  name: string | null
  /** Every valid ABN printed in the headings; a trust's statements may show the trust's. */
  abns: string[]
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

/** A check over the stored statements, run when the comparison is built. */
export type FinancialCheckKind =
  | 'totals_reconciliation'
  | 'balance_sheet_equation'
  | 'retained_earnings_rollforward'
  | 'restatement'
  | 'entity_mismatch'
  | 'not_statements'
  | 'extraction_note'
  | 'mapping_consistency'

export interface FinancialCheck {
  kind: FinancialCheckKind
  /** 'warning' needs a look; 'info' explains something that is probably fine. */
  severity: 'warning' | 'info'
  /** Null for a check about a document as a whole. */
  financialYear: number | null
  /** The statement it concerns, when it concerns one. */
  statement: StatementHalfKey | null
  /** It concerns the current-period statement rather than an annual one. */
  currentPeriod?: boolean
  message: string
  /** The documents involved, for linking to the file. */
  documentIds: string[]
  /** Notes of one sort collapse into one line in the panel; see ComparisonChecksPanel. */
  group?: string
  /** The items behind a summary, shown collapsed (e.g. the lines a reclassification moved). */
  details?: string[]
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
  /**
   * Annual FYs that have statements but fall outside the latest four, so are
   * not in `years`. Shown as extra in the coverage table. Absent on
   * comparisons built before the year window.
   */
  extraYears?: number[]
  /** Checks run over the statements. Absent on comparisons built before them. */
  checks?: FinancialCheck[]
  /**
   * Retained earnings (balance sheet) and what was paid out (P&L
   * appropriations) per compared year — for the AI summary, which must never
   * stand in a sum of profits for retained earnings.
   */
  equityByYear?: Record<number, { retainedEarnings: number | null; distributions: number | null; dividends: number | null }>
}
