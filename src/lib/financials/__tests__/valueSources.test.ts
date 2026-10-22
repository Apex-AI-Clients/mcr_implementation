import { describe, it, expect } from 'vitest'
import { computeFinancialsComparison } from '../computeComparison'
import {
  explainBalanceLine,
  explainBalanceTotal,
  explainDistributionRow,
  explainIncomeLine,
  explainIncomeTotal,
  explainLoanAccountNet,
} from '../valueSources'
import type { ExtractedFinancialStatement, StatementLine } from '../types'

function line(section: StatementLine['section'], rawLabel: string, value: number | null, canonicalKey: string | null, isTotal = false): StatementLine {
  return { section, rawLabel, value, canonicalKey, isTotal }
}

function statement(fy: number, lines: StatementLine[] = []): ExtractedFinancialStatement {
  return {
    financialYear: fy,
    periodEndDate: `${fy}-06-30`,
    sourceFilename: `FY${fy} Financials.pdf`,
    sourceColumn: 'primary',
    incomeStatement: {
      income: { sales: 500_000, interestIncome: 1_000 },
      cogs: { openingStock: 10_000, purchases: 200_000, closingStock: 15_000 },
      expenses: { rent: 30_000, wagesAndSalaries: 120_000 },
      totals: {
        totalIncome: 501_000,
        totalCogs: 195_000,
        grossProfit: 306_000,
        totalExpenses: 150_000,
        profitBeforeTax: 156_000,
        netProfitAfterTax: 156_000,
      },
      lines,
    },
    balanceSheet: {
      currentAssets: { bankAccounts: 40_000, accountsReceivable: 60_000 },
      nonCurrentAssets: { propertyPlantEquipment: 150_000, directorRelatedLoansReceivable: 25_000 },
      currentLiabilities: { gstPayable: 12_000, atoLiability: 30_000 },
      nonCurrentLiabilities: { directorRelatedLoansPayable: 5_000 },
      equity: { shareCapital: 100, retainedEarnings: 227_900 },
      totals: {
        totalCurrentAssets: 100_000,
        totalNonCurrentAssets: 175_000,
        totalAssets: 275_000,
        totalCurrentLiabilities: 42_000,
        totalNonCurrentLiabilities: 5_000,
        totalLiabilities: 47_000,
        netAssets: 228_000,
        totalEquity: 228_000,
      },
    },
    rawExtraction: [],
    warnings: [],
    present: { income_statement: true, balance_sheet: true },
  }
}

describe('explainIncomeLine', () => {
  it('names the file and the printed lines added into one figure', () => {
    const s = statement(2025, [
      line('expenses', 'Rent - Office', 18_000, 'expenses.rent'),
      line('expenses', 'Rent - Storage', 12_000, 'expenses.rent'),
    ])
    expect(explainIncomeLine('expenses', s, 'rent', 30_000)).toEqual({
      kind: 'picked',
      sourceFilename: 'FY2025 Financials.pdf',
      printed: [
        { label: 'Rent - Office', value: 18_000 },
        { label: 'Rent - Storage', value: 12_000 },
      ],
    })
  })

  it('is nil when the statement does not list the line', () => {
    expect(explainIncomeLine('expenses', statement(2025), 'tolls', 0)).toEqual({ kind: 'nil', sourceFilename: 'FY2025 Financials.pdf' })
  })

  it('names only the file when the printed lines do not add up to the figure', () => {
    const s = statement(2025, [line('income', 'Sales', 400_000, 'income.sales')])
    expect(explainIncomeLine('income', s, 'sales', 500_000)).toEqual({ kind: 'picked', sourceFilename: 'FY2025 Financials.pdf' })
  })
})

describe('explainIncomeTotal', () => {
  it('is calculated, with the formula, when no total is printed', () => {
    expect(explainIncomeTotal(statement(2025), 'grossProfit', 306_000)).toEqual({
      kind: 'calculated',
      sourceFilename: 'FY2025 Financials.pdf',
      terms: [
        { label: 'Total Income', value: 501_000, sign: 1 },
        { label: 'Total Cost of Goods Sold', value: 195_000, sign: -1 },
      ],
    })
  })

  it('takes closing stock off cost of sales', () => {
    const r = explainIncomeTotal(statement(2025), 'totalCogs', 195_000)
    expect(r?.kind).toBe('calculated')
    expect(r?.terms?.find((t) => t.label === 'Closing Stock')).toEqual({ label: 'Closing Stock', value: 15_000, sign: -1 })
  })

  it('is picked when the total is printed, with the check that it adds up', () => {
    const s = statement(2025, [line('expenses', 'Total Expenses', 150_000, 'totals.totalExpenses', true)])
    const r = explainIncomeTotal(s, 'totalExpenses', 150_000)
    expect(r?.kind).toBe('picked')
    expect(r?.printed).toEqual([{ label: 'Total Expenses', value: 150_000 }])
    expect(r?.terms).toHaveLength(2)
  })

  it('explains net profit equal to profit before tax when there is no tax line', () => {
    const r = explainIncomeTotal(statement(2025), 'netProfitAfterTax', 156_000)
    expect(r?.kind).toBe('calculated')
    expect(r?.note).toMatch(/no income tax/i)
  })

  it('takes the printed tax line off profit before tax', () => {
    const s = statement(2025, [line('incomeTax', 'Income tax expense', 39_000, null)])
    s.incomeStatement.totals.netProfitAfterTax = 117_000
    expect(explainIncomeTotal(s, 'netProfitAfterTax', 117_000)?.terms).toEqual([
      { label: 'Profit / (Loss) before Taxation', value: 156_000, sign: 1 },
      { label: 'Income tax expense', value: 39_000, sign: -1 },
    ])
  })
})

describe('explainDistributionRow', () => {
  it('works out net profit after distributions when it is not printed', () => {
    const s = statement(2025)
    s.incomeStatement.appropriations = { distributions: 156_000 }
    expect(explainDistributionRow(s, 'netProfitAfterDistributions', 0)?.kind).toBe('calculated')
  })
})

describe('explainBalanceLine', () => {
  it('names the balance sheet file, which can differ from the P&L file', () => {
    const s = statement(2025, [])
    s.halfFilenames = { income_statement: 'FY2025 P&L.pdf', balance_sheet: 'FY2026 Financials.pdf' }
    s.balanceSheet.lines = [line('currentAssets', 'Cash at Bank', 40_000, 'currentAssets.bankAccounts')]
    expect(explainBalanceLine('currentAssets', s, 'bankAccounts', 40_000)).toEqual({
      kind: 'picked',
      sourceFilename: 'FY2026 Financials.pdf',
      printed: [{ label: 'Cash at Bank', value: 40_000 }],
    })
    expect(explainIncomeLine('income', s, 'sales', 500_000)?.sourceFilename).toBe('FY2025 P&L.pdf')
  })

  it('matches a loan printed negative but stored positive', () => {
    const s = statement(2025)
    s.balanceSheet.lines = [line('nonCurrentLiabilities', 'Loan - Director', -5_000, 'nonCurrentLiabilities.directorRelatedLoansPayable')]
    expect(explainBalanceLine('nonCurrentLiabilities', s, 'directorRelatedLoansPayable', 5_000)?.printed).toEqual([
      { label: 'Loan - Director', value: 5_000 },
    ])
  })
})

describe('explainBalanceTotal', () => {
  it('works out total assets and net assets from the section totals', () => {
    const s = statement(2025)
    expect(explainBalanceTotal(s, 'totalAssets', 275_000)?.terms).toEqual([
      { label: 'Total Current Assets', value: 100_000, sign: 1 },
      { label: 'Total Non-Current Assets', value: 175_000, sign: 1 },
    ])
    expect(explainBalanceTotal(s, 'netAssets', 228_000)?.terms).toEqual([
      { label: 'Total Assets', value: 275_000, sign: 1 },
      { label: 'Total Liabilities', value: 47_000, sign: -1 },
    ])
  })

  it('adds up a section total from its lines', () => {
    expect(explainBalanceTotal(statement(2025), 'totalCurrentLiabilities', 42_000)).toMatchObject({ kind: 'calculated' })
  })
})

describe('explainLoanAccountNet', () => {
  it('is receivable less payable', () => {
    const r = explainLoanAccountNet(statement(2025), 'directorLoanAccountNet', 20_000)
    expect(r?.terms?.map((t) => [t.value, t.sign])).toEqual([[25_000, 1], [5_000, -1]])
  })
})

describe('computeFinancialsComparison — sources', () => {
  it('attaches a source to every figure on both statements', () => {
    const c = computeFinancialsComparison([statement(2024), statement(2025)])
    for (const section of [...c.incomeStatementDiffs, ...c.balanceSheetDiffs]) {
      for (const row of section.rows) expect(row.sourcesByYear?.[2025]).toBeTruthy()
    }
  })
})
