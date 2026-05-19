import { describe, it, expect } from 'vitest'
import {
  ATO_LIABILITY_KEYS,
  BALANCE_SHEET_SCHEMA,
  INCOME_STATEMENT_SCHEMA,
} from '../schema'

/**
 * These tests lock the canonical key names. The extraction prompt, the
 * comparison engine, the diff tables, the AI summary template, and any
 * persisted JSON in the database all rely on these exact strings being
 * stable. If you intentionally rename a key, update both the schema and
 * any migration that backfills existing financial_statements rows.
 */

describe('canonical schema keys', () => {
  it('income statement schema is stable', () => {
    expect(Object.keys(INCOME_STATEMENT_SCHEMA.income).sort()).toEqual(
      ['interestIncome', 'other', 'otherRevenue', 'sales'].sort(),
    )
    expect(Object.keys(INCOME_STATEMENT_SCHEMA.cogs).sort()).toEqual(
      ['directCosts', 'other', 'purchases'].sort(),
    )
    expect(INCOME_STATEMENT_SCHEMA.totals).toEqual({
      totalIncome: 'Total Income',
      totalCogs: 'Total Cost of Goods Sold',
      grossProfit: 'Gross Profit',
      totalExpenses: 'Total Expenses',
      profitBeforeTax: 'Profit / (Loss) before Taxation',
      netProfitAfterTax: 'Net Profit After Tax',
    })
    // Spot-check a few critical expense keys
    expect(INCOME_STATEMENT_SCHEMA.expenses.wagesAndSalaries).toBe('Wages & Salaries')
    expect(INCOME_STATEMENT_SCHEMA.expenses.depreciation).toBe('Depreciation')
    expect(INCOME_STATEMENT_SCHEMA.expenses.superannuation).toBe('Superannuation')
  })

  it('balance sheet schema is stable', () => {
    expect(BALANCE_SHEET_SCHEMA.nonCurrentAssets.directorRelatedLoansReceivable).toBe(
      'Director/Related Party Loans Receivable',
    )
    expect(BALANCE_SHEET_SCHEMA.currentLiabilities.atoLiability).toBe(
      'ATO Liability (Activity Statement Account)',
    )
    expect(BALANCE_SHEET_SCHEMA.totals).toEqual({
      totalCurrentAssets: 'Total Current Assets',
      totalNonCurrentAssets: 'Total Non-Current Assets',
      totalAssets: 'Total Assets',
      totalCurrentLiabilities: 'Total Current Liabilities',
      totalNonCurrentLiabilities: 'Total Non-Current Liabilities',
      totalLiabilities: 'Total Liabilities',
      netAssets: 'Net Assets',
      totalEquity: 'Total Equity',
    })
  })

  it('ATO liability aggregation covers the four ATO-related current liabilities', () => {
    expect([...ATO_LIABILITY_KEYS].sort()).toEqual(
      ['atoLiability', 'gstPayable', 'paygWithholdingPayable', 'superannuationPayable'].sort(),
    )
  })
})
