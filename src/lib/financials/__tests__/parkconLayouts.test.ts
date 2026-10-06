import { describe, it, expect } from 'vitest'
import { signedChange } from '../changeLabel'
import { arithmeticFindings } from '../checks'
import { correctFile, type FileColumn } from '../lineCorrections'
import type { ExtractedBalanceSheet, ExtractedIncomeStatement, LineSection, StatementLine } from '../types'

/**
 * PARKCON-style layouts. SYNTHETIC figures (round numbers, not the client's),
 * laid out the way that accountant's template prints them.
 */

const line = (
  section: LineSection,
  rawLabel: string,
  value: number | null,
  canonicalKey: string | null,
  isTotal = false,
): StatementLine => ({ section, rawLabel, value, canonicalKey, isTotal })

const blankIs = (): ExtractedIncomeStatement => ({ income: {}, cogs: {}, expenses: {}, totals: {} })
const blankBs = (): ExtractedBalanceSheet => ({
  currentAssets: {},
  nonCurrentAssets: {},
  currentLiabilities: {},
  nonCurrentLiabilities: {},
  equity: {},
  totals: {},
})
const column = (index: number, lines: StatementLine[], is: Partial<ExtractedIncomeStatement> = {}, bs: Partial<ExtractedBalanceSheet> = {}): FileColumn => ({
  index,
  lines,
  incomeStatement: { ...blankIs(), ...is },
  balanceSheet: { ...blankBs(), ...bs },
})

describe('"Total Income" printed twice (items 1 and 2)', () => {
  // Income: Sales 700,000 → "Total Income 700,000"; less COGS 450,000;
  // Other Income: Interest 5,000; then "Total Income 255,000" (= gross profit
  // 250,000 + other income 5,000); expenses 200,000; profit 55,000.
  const printedRows = [
    'Income',
    'Sales 700,000 600,000',
    'Total Income 700,000 600,000',
    'Cost of Goods Sold',
    'Purchases 450,000 380,000',
    'Total Cost of Goods Sold 450,000 380,000',
    'Other Income',
    'Interest Received 5,000 4,000',
    'Total Income 255,000 224,000',
    'Expenses',
    'Wages 200,000 180,000',
    'Total Expenses 200,000 180,000',
    'Net Profit 55,000 44,000',
  ]
  const pnl = (index: number, v: { sales: number; cogs: number; interest: number; second: number; wages: number; profit: number }) =>
    column(
      index,
      [
        line('income', 'Sales', v.sales, 'income.sales'),
        line('income', 'Total Income', v.sales, 'totals.totalIncome', true),
        line('cogs', 'Purchases', v.cogs, 'cogs.purchases'),
        line('cogs', 'Total Cost of Goods Sold', v.cogs, 'totals.totalCogs', true),
        line('otherIncome', 'Interest Received', v.interest, 'income.interestIncome'),
        line('otherIncome', 'Total Income', v.second, 'totals.totalIncome', true),
        line('expenses', 'Wages', v.wages, 'expenses.wagesAndSalaries'),
        line('expenses', 'Total Expenses', v.wages, 'totals.totalExpenses', true),
        line('incomeTotals', 'Net Profit', v.profit, 'totals.profitBeforeTax', true),
      ],
      {
        income: { sales: v.sales, interestIncome: v.interest },
        cogs: { purchases: v.cogs },
        expenses: { wagesAndSalaries: v.wages },
        // The model took the SECOND "Total Income" as total income, and as gross profit.
        totals: { totalIncome: v.second, totalCogs: v.cogs, totalExpenses: v.wages, profitBeforeTax: v.profit, grossProfit: v.second },
      },
    )

  it('takes the first "Total Income" by printed order, and works out gross profit', () => {
    const fy2025 = pnl(0, { sales: 700_000, cogs: 450_000, interest: 5_000, second: 255_000, wages: 200_000, profit: 55_000 })
    const fy2024 = pnl(1, { sales: 600_000, cogs: 380_000, interest: 4_000, second: 224_000, wages: 180_000, profit: 44_000 })
    const { columnNotes } = correctFile([fy2025, fy2024], { isTrust: false }, { is: printedRows, bs: [], columns: 2 })

    expect(fy2025.incomeStatement.totals.totalIncome).toBe(700_000)
    expect(fy2024.incomeStatement.totals.totalIncome).toBe(600_000)
    // No "Gross Profit" line is printed: total income less cost of sales, never the second "Total Income".
    expect(fy2025.incomeStatement.totals.grossProfit).toBe(250_000)
    expect(fy2024.incomeStatement.totals.grossProfit).toBe(220_000)
    expect(columnNotes[0].map((n) => n.group)).toEqual(expect.arrayContaining(['total_income', 'gross_profit']))
  })

  it('uses the order of the returned lines when the text layer is not available', () => {
    const fy2025 = pnl(0, { sales: 700_000, cogs: 450_000, interest: 5_000, second: 255_000, wages: 200_000, profit: 55_000 })
    correctFile([fy2025], { isTrust: false }, null)
    expect(fy2025.incomeStatement.totals.totalIncome).toBe(700_000)
  })

  it('does not raise a false profit warning when other income sits outside total income', () => {
    const s = { incomeStatement: { ...blankIs(), income: { sales: 700_000, interestIncome: 5_000 }, totals: { totalIncome: 700_000, totalCogs: 450_000, totalExpenses: 200_000, profitBeforeTax: 55_000 } }, balanceSheet: blankBs() }
    expect(arithmeticFindings(s)).toEqual([])
  })
})

describe('negative director loans under liabilities (item 3)', () => {
  it('moves "Loan 2019 (7,325)" and "Loan 2020 (21,964)" to a POSITIVE director loan receivable, with notes', () => {
    const col = column(
      0,
      [
        line('nonCurrentLiabilities', 'Loan - Hino Truck', 90_000, 'nonCurrentLiabilities.chattelMortgages'),
        line('nonCurrentLiabilities', 'Loan 2019', -7_325, 'nonCurrentLiabilities.other'),
        line('nonCurrentLiabilities', 'Loan 2020', -21_964, 'nonCurrentAssets.directorRelatedLoansReceivable'),
        line('nonCurrentLiabilities', 'Total Non-Current Liabilities', 60_711, 'totals.totalNonCurrentLiabilities', true),
      ],
      {},
      {
        nonCurrentLiabilities: { chattelMortgages: 90_000, other: { 'Loan 2019': -7_325 } } as never,
        nonCurrentAssets: { directorRelatedLoansReceivable: -21_964 },
      },
    )
    const { columnNotes } = correctFile([col], { isTrust: false }, null)
    expect(col.balanceSheet.nonCurrentAssets.directorRelatedLoansReceivable).toBe(29_289)
    expect(col.balanceSheet.nonCurrentLiabilities).toEqual({ chattelMortgages: 90_000 })
    expect(columnNotes[0].filter((n) => n.group === 'negative_loan')).toHaveLength(2)
  })

  it('never leaves a director loan receivable negative', () => {
    const col = column(0, [line('currentAssets', 'Cash at Bank', 1_000, 'currentAssets.bankAccounts')], {}, { nonCurrentAssets: { directorRelatedLoansReceivable: -21_964 } })
    correctFile([col], { isTrust: false }, null)
    expect(col.balanceSheet.nonCurrentAssets.directorRelatedLoansReceivable).toBe(21_964)
  })

  it('leaves a negative lender loan under liabilities alone', () => {
    const col = column(0, [line('nonCurrentLiabilities', 'Loan - Westpac', -500, 'nonCurrentLiabilities.loansAndFinance')], {}, { nonCurrentLiabilities: { loansAndFinance: -500 } })
    correctFile([col], { isTrust: false }, null)
    expect(col.balanceSheet.nonCurrentAssets.directorRelatedLoansReceivable).toBeUndefined()
  })
})

describe('overdrawn bank account (item 4)', () => {
  it('reads "Business Account" under current liabilities as a bank overdraft, and the "-" asset line as $0', () => {
    const col = column(
      0,
      [
        line('currentAssets', 'Business Account', null, 'currentAssets.bankAccounts'),
        line('currentAssets', 'Trade Debtors', 20_000, 'currentAssets.accountsReceivable'),
        line('currentLiabilities', 'Business Account', 4_268, 'currentAssets.bankAccounts'),
        line('currentLiabilities', 'GST', 3_000, 'currentLiabilities.gstPayable'),
      ],
      {},
      { currentAssets: { bankAccounts: 4_268, accountsReceivable: 20_000 }, currentLiabilities: { gstPayable: 3_000 } },
    )
    correctFile([col], { isTrust: false }, null)
    expect(col.balanceSheet.currentLiabilities.bankOverdraft).toBe(4_268)
    expect(col.balanceSheet.currentAssets.bankAccounts).toBe(0)
  })
})

describe('current-period payables (item 5)', () => {
  it('maps "Wages Payable - Payroll" to other current liabilities, never taxation, and "Rounding" to other', () => {
    const col = column(
      0,
      [
        line('currentLiabilities', 'Wages Payable - Payroll', -1_388.48, 'currentLiabilities.taxation'),
        line('currentLiabilities', 'Rounding', 0.02, 'currentLiabilities.taxation'),
        line('currentLiabilities', 'GST', 2_000, 'currentLiabilities.gstPayable'),
      ],
      {},
      { currentLiabilities: { taxation: -1_388.46, gstPayable: 2_000 } },
    )
    correctFile([col], { isTrust: false }, null)
    const cl = col.balanceSheet.currentLiabilities as Record<string, unknown>
    expect(cl.taxation).toBeUndefined()
    expect(cl.other).toEqual({ 'Wages payable': -1_388.48, Rounding: 0.02 })
  })
})

describe('changes shown in dollars when a value is negative (item 7)', () => {
  it.each([
    [-20_000, -53_684, 'Loss', 'Loss up $33,684'],
    [-53_684, -19_038, 'Loss', 'Loss down $34,646'],
    [12_000, -5_000, 'Loss', 'Into loss, down $17,000'],
    [-5_000, 9_000, 'Loss', 'Out of loss, up $14,000'],
    [-90_000, -20_000, 'Deficit', 'Deficit down $70,000'],
    [-500, 300, null, 'Up $800'],
  ] as const)('%s → %s reads "%s…"', (prev, curr, noun, text) => {
    expect(signedChange(prev, curr, { noun })?.text).toBe(text)
  })

  it('keeps the percentage when both values are zero or above', () => {
    expect(signedChange(100, 150, { noun: 'Loss' })).toBeNull()
  })

  it('marks a growing loss as worse and a shrinking one as better', () => {
    expect(signedChange(-20_000, -53_684, { noun: 'Loss' })?.improved).toBe(false)
    expect(signedChange(-53_684, -19_038, { noun: 'Loss' })?.improved).toBe(true)
  })
})
