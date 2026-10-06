import type { Database } from '@/types/database'
import type {
  ExtractedBalanceSheet,
  ExtractedIncomeStatement,
  ExtractionWarning,
  FinancialStatementSourceColumn,
  StatementHalfKey,
  StoredHalf,
  StoredStatementSlot,
} from './types'

/**
 * A financial_statements row -> its two halves (migration 0026).
 *
 * Pure, so the rules the migration's backfill applies in SQL are pinned here
 * in tests. The two must stay identical: if one changes, change the other.
 *
 * Two kinds of row exist on the shared database:
 *
 *   - Split: at least one half has its own document id. Each half is present
 *     exactly when it has an owner — the new code only ever writes real halves.
 *   - Legacy: no per-half owner. Written whole by the code before 0026, or by
 *     it during the release window (the guard trigger turns a rewritten split
 *     row back into this). Each half counts only if it holds real data, and
 *     both take the row's own document_id and source_filename.
 */

export type FinancialStatementRow = Database['public']['Tables']['financial_statements']['Row']

/** Real data in an income statement: the same four values the backfill checks. */
export function hasRealIncomeStatement(value: unknown): boolean {
  const is = (value ?? {}) as {
    income?: { sales?: unknown }
    totals?: { totalIncome?: unknown; profitBeforeTax?: unknown; netProfitAfterTax?: unknown }
  }
  return (
    is.income?.sales != null ||
    is.totals?.totalIncome != null ||
    is.totals?.profitBeforeTax != null ||
    is.totals?.netProfitAfterTax != null
  )
}

/** Real data in a balance sheet: the same four totals the backfill checks. */
export function hasRealBalanceSheet(value: unknown): boolean {
  const bs = (value ?? {}) as {
    totals?: {
      totalAssets?: unknown
      totalLiabilities?: unknown
      netAssets?: unknown
      totalEquity?: unknown
    }
  }
  return (
    bs.totals?.totalAssets != null ||
    bs.totals?.totalLiabilities != null ||
    bs.totals?.netAssets != null ||
    bs.totals?.totalEquity != null
  )
}

const INCOME_STATEMENT_SECTIONS = new Set([
  'incomestatement',
  'profitandloss',
  'income',
  'otherincome',
  'revenue',
  'otherrevenue',
  'cogs',
  'costofsales',
  'costofgoodssold',
  'expenses',
  'operatingexpenses',
])

const BALANCE_SHEET_SECTIONS = new Set([
  'balancesheet',
  'assets',
  'currentassets',
  'noncurrentassets',
  'liabilities',
  'currentliabilities',
  'noncurrentliabilities',
  'equity',
])

/**
 * Which half a warning belongs to, from its section: the part before any ">",
 * letters only, lowercased ("Income > Other Revenue" -> "income"). Null when
 * it names neither — such a warning is shown against the whole slot.
 */
export function warningHalf(section: string | undefined | null): StatementHalfKey | null {
  const key = (section ?? '').split('>')[0].replace(/[^a-zA-Z]/g, '').toLowerCase()
  if (INCOME_STATEMENT_SECTIONS.has(key)) return 'income_statement'
  if (BALANCE_SHEET_SECTIONS.has(key)) return 'balance_sheet'
  return null
}

function warningsOf(value: unknown): ExtractionWarning[] {
  return Array.isArray(value)
    ? (value as ExtractionWarning[]).filter((w) => w !== null && typeof w === 'object')
    : []
}

export function isLegacyRow(row: FinancialStatementRow): boolean {
  return row.is_document_id === null && row.bs_document_id === null
}

export function toStoredSlot(row: FinancialStatementRow): StoredStatementSlot {
  const legacy = isLegacyRow(row)
  const rowWarnings = warningsOf(row.extraction_warnings)

  let incomeStatement: StoredHalf<ExtractedIncomeStatement> | null = null
  let balanceSheet: StoredHalf<ExtractedBalanceSheet> | null = null

  if (legacy) {
    const forHalf = (half: StatementHalfKey) =>
      rowWarnings.filter((w) => warningHalf(w.section) === half)
    if (row.income_statement !== null && hasRealIncomeStatement(row.income_statement)) {
      incomeStatement = {
        data: row.income_statement as unknown as ExtractedIncomeStatement,
        documentId: row.document_id,
        sourceFilename: row.source_filename,
        extractedAt: row.extracted_at,
        warnings: forHalf('income_statement'),
      }
    }
    if (row.balance_sheet !== null && hasRealBalanceSheet(row.balance_sheet)) {
      balanceSheet = {
        data: row.balance_sheet as unknown as ExtractedBalanceSheet,
        documentId: row.document_id,
        sourceFilename: row.source_filename,
        extractedAt: row.extracted_at,
        warnings: forHalf('balance_sheet'),
      }
    }
  } else {
    if (row.is_document_id !== null && row.income_statement !== null) {
      incomeStatement = {
        data: row.income_statement as unknown as ExtractedIncomeStatement,
        documentId: row.is_document_id,
        sourceFilename: row.is_source_filename,
        extractedAt: row.is_extracted_at,
        warnings: warningsOf(row.is_warnings),
      }
    }
    if (row.bs_document_id !== null && row.balance_sheet !== null) {
      balanceSheet = {
        data: row.balance_sheet as unknown as ExtractedBalanceSheet,
        documentId: row.bs_document_id,
        sourceFilename: row.bs_source_filename,
        extractedAt: row.bs_extracted_at,
        warnings: warningsOf(row.bs_warnings),
      }
    }
  }

  return {
    id: row.id,
    financialYear: row.financial_year,
    periodEndDate: row.period_end_date,
    periodStartDate: row.period_start_date,
    periodLabel: row.period_label,
    sourceColumn: row.source_column as FinancialStatementSourceColumn,
    incomeStatement,
    balanceSheet,
    // Backfilled and legacy rows keep every warning here; only the ones that
    // name neither half belong to the slot as a whole.
    slotWarnings: rowWarnings.filter((w) => warningHalf(w.section) === null),
    legacy,
    extractionModel: row.extraction_model,
  }
}
