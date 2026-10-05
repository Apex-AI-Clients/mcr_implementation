import { describe, it, expect } from 'vitest'
import { correctColumn, correctProfit, fixSwappedTotals, type Column } from '../lineCorrections'
import type { ExtractedBalanceSheet, ExtractedIncomeStatement, LineSection, StatementLine } from '../types'

/**
 * Deterministic corrections over the model's mapping. SYNTHETIC figures laid
 * out the way the real separate-file trust statements print them.
 */

const line = (
  section: LineSection,
  rawLabel: string,
  value: number | null,
  canonicalKey: string | null,
  isTotal = false,
): StatementLine => ({ section, rawLabel, value, canonicalKey, isTotal })

function blankIs(): ExtractedIncomeStatement {
  return { income: {}, cogs: {}, expenses: {}, totals: {} }
}
function blankBs(): ExtractedBalanceSheet {
  return { currentAssets: {}, nonCurrentAssets: {}, currentLiabilities: {}, nonCurrentLiabilities: {}, equity: {}, totals: {} }
}

describe('trust P&L with prior-year loss lines (NPAT = PBT)', () => {
  // Sales 200,000; cost of sales 120,000; expenses 50,000 -> operating profit 30,000.
  // Then: "Less Prior Year Loss" 12,000 and "NET TRADING PROFIT/(LOSS) AFTER DEDUCTING LOSS" 18,000,
  // then "Distribution to Beneficiaries" 18,000. The model read 18,000 as net profit after tax.
  function trustColumn(pbtFromModel = 30_000) {
    const s = {
      incomeStatement: {
        ...blankIs(),
        income: { sales: 200_000 },
        cogs: { purchases: 120_000 },
        expenses: { rent: 20_000, wagesAndSalaries: 30_000 },
        totals: {
          totalIncome: 200_000,
          totalCogs: 120_000,
          totalExpenses: 50_000,
          profitBeforeTax: pbtFromModel,
          netProfitAfterTax: 18_000,
        },
      },
      balanceSheet: blankBs(),
    }
    const lines = [
      line('income', 'Sales', 200_000, 'income.sales'),
      line('cogs', 'Purchases', 120_000, 'cogs.purchases'),
      line('expenses', 'Rent', 20_000, 'expenses.rent'),
      line('expenses', 'Wages', 30_000, 'expenses.wagesAndSalaries'),
      line('incomeTotals', 'Net Trading Profit', 30_000, 'totals.profitBeforeTax', true),
      line('appropriation', 'Less Prior Year Loss', 12_000, null),
      line('incomeTotals', 'NET TRADING PROFIT/(LOSS) AFTER DEDUCTING LOSS', 18_000, 'totals.netProfitAfterTax', true),
      line('appropriation', 'Distribution to Beneficiaries', 18_000, null),
    ]
    return { s, lines }
  }

  it('sets net profit after tax to profit before tax, and captures the appropriations', () => {
    const { s, lines } = trustColumn()
    const notes = correctColumn(s, lines, { isTrust: true })
    expect(s.incomeStatement.totals.netProfitAfterTax).toBe(30_000)
    expect(s.incomeStatement.totals.profitBeforeTax).toBe(30_000)
    expect(s.incomeStatement.appropriations).toEqual({ priorYearLossesApplied: 12_000, distributions: 18_000 })
    // Net profit after tax was cleared from the after-loss line and refilled from PBT; nothing else to report.
    expect(notes.filter((n) => n.kind === 'mapping_corrected')).toEqual([])
  })

  it('does the same for a company with no income tax line, and says so when the figure was kept', () => {
    const { s } = trustColumn()
    const noLossLines = [line('incomeTotals', 'Net Profit', 30_000, 'totals.profitBeforeTax', true)]
    const notes = correctProfit(s, noLossLines, { isTrust: false })
    expect(s.incomeStatement.totals.netProfitAfterTax).toBe(30_000)
    expect(notes).toEqual([expect.objectContaining({ kind: 'profit_corrected', message: expect.stringMatching(/no income tax expense/) })])
  })

  it('rebuilds profit before tax that was read from the after-loss line', () => {
    const { s, lines } = trustColumn(18_000)
    const notes = correctColumn(s, lines, { isTrust: true })
    expect(s.incomeStatement.totals.profitBeforeTax).toBe(30_000)
    expect(s.incomeStatement.totals.netProfitAfterTax).toBe(30_000)
    expect(notes.map((n) => n.kind)).toContain('profit_corrected')
  })

  it('leaves a company with an income tax line alone', () => {
    const s = { incomeStatement: { ...blankIs(), totals: { profitBeforeTax: 100, netProfitAfterTax: 75 } }, balanceSheet: blankBs() }
    const notes = correctProfit(s, [line('incomeTax', 'Income Tax Expense', 25, null)], { isTrust: false })
    expect(s.incomeStatement.totals.netProfitAfterTax).toBe(75)
    expect(notes).toEqual([])
  })

  it('applies the trust rule even without lines (older extractions)', () => {
    const s = { incomeStatement: { ...blankIs(), totals: { profitBeforeTax: 100, netProfitAfterTax: 60 } }, balanceSheet: blankBs() }
    correctProfit(s, [], { isTrust: true })
    expect(s.incomeStatement.totals.netProfitAfterTax).toBe(100)
  })

  it('does not apply the no-tax rule to a company without lines (nothing to go on)', () => {
    const s = { incomeStatement: { ...blankIs(), totals: { profitBeforeTax: 100, netProfitAfterTax: 75 } }, balanceSheet: blankBs() }
    correctProfit(s, [], { isTrust: false })
    expect(s.incomeStatement.totals.netProfitAfterTax).toBe(75)
  })
})

describe('opening and closing stock', () => {
  it('moves stock out of direct costs, keeping closing stock positive', () => {
    const s = {
      incomeStatement: {
        ...blankIs(),
        cogs: { purchases: 80_000, directCosts: 15_000 - 20_000 },
        totals: { totalCogs: 75_000 },
      },
      balanceSheet: blankBs(),
    }
    // The model lumped opening (15,000) and closing (-20,000) stock into direct costs.
    const lines = [
      line('cogs', 'Opening Stock', 15_000, 'cogs.directCosts'),
      line('cogs', 'Purchases', 80_000, 'cogs.purchases'),
      line('cogs', 'Less Closing Stock', -20_000, 'cogs.directCosts'),
      line('cogs', 'Total Cost of Sales', 75_000, 'totals.totalCogs', true),
    ]
    const notes = correctColumn(s, lines, { isTrust: false })
    expect(s.incomeStatement.cogs).toEqual({ purchases: 80_000, openingStock: 15_000, closingStock: 20_000 })
    expect(notes.filter((n) => n.kind === 'mapping_corrected')).toHaveLength(2)
  })
})

describe('mapping dictionary', () => {
  it('moves a bond out of property, plant & equipment and keeps shop fittings there', () => {
    const s = {
      incomeStatement: blankIs(),
      balanceSheet: { ...blankBs(), nonCurrentAssets: { propertyPlantEquipment: 45_000 } },
    }
    const lines = [
      line('nonCurrentAssets', 'Shop Fittings', 40_000, 'nonCurrentAssets.propertyPlantEquipment'),
      line('nonCurrentAssets', 'Rental Bond', 5_000, 'nonCurrentAssets.propertyPlantEquipment'),
    ]
    correctColumn(s, lines, { isTrust: false })
    expect(s.balanceSheet.nonCurrentAssets).toEqual({ propertyPlantEquipment: 40_000, other: { Deposits: 5_000 } })
    expect(lines[1].canonicalKey).toBe('nonCurrentAssets.other.Deposits')
  })

  it('moves a person-named loan to director loans payable, from wherever it was filed', () => {
    const s = {
      incomeStatement: blankIs(),
      balanceSheet: { ...blankBs(), nonCurrentLiabilities: { loansAndFinance: 70_000 } },
    }
    const lines = [
      line('nonCurrentLiabilities', 'Loan - Westpac', 50_000, 'nonCurrentLiabilities.loansAndFinance'),
      line('nonCurrentLiabilities', 'Loan - Jane Citizen', 20_000, 'nonCurrentLiabilities.loansAndFinance'),
    ]
    correctColumn(s, lines, { isTrust: false })
    expect(s.balanceSheet.nonCurrentLiabilities).toEqual({ loansAndFinance: 50_000, directorRelatedLoansPayable: 20_000 })
  })

  it('takes an unmapped line out of the "other" entry it was filed under', () => {
    const s = {
      incomeStatement: blankIs(),
      // The schema types "other" as one number; the model returns named entries.
      balanceSheet: { ...blankBs(), nonCurrentAssets: { other: { 'Bond Rent': 3_000 } } } as unknown as ExtractedBalanceSheet,
    }
    correctColumn(s, [line('nonCurrentAssets', 'Bond Rent', 3_000, null)], { isTrust: false })
    expect(s.balanceSheet.nonCurrentAssets).toEqual({ other: { Deposits: 3_000 } })
  })

  it('never adds a line it cannot find where the model filed it (no double count)', () => {
    const s = { incomeStatement: blankIs(), balanceSheet: { ...blankBs(), nonCurrentAssets: { propertyPlantEquipment: 40_000 } } }
    correctColumn(s, [line('nonCurrentAssets', 'Bond', 5_000, null)], { isTrust: false })
    expect(s.balanceSheet.nonCurrentAssets).toEqual({ propertyPlantEquipment: 40_000 })
  })
})

describe('swapped total columns', () => {
  function column(expenses: number[], printedTotal: number): Column {
    const lines = [
      ...expenses.map((v, i) => line('expenses', `Expense ${i + 1}`, v, null)),
      line('expenses', 'Total Expenses', printedTotal, 'totals.totalExpenses', true),
    ]
    return {
      incomeStatement: { ...blankIs(), totals: { totalExpenses: printedTotal } },
      balanceSheet: blankBs(),
      lines,
    }
  }

  it('takes each column total from its own lines when the printed totals sit in the wrong columns', () => {
    // 2025 lines add to 60,000 and 2024 lines to 45,000, but the totals are printed the other way round.
    const fy2025 = column([40_000, 20_000], 45_000)
    const fy2024 = column([30_000, 15_000], 60_000)
    expect(fixSwappedTotals(fy2025, fy2024)).toBe(true)
    expect(fy2025.incomeStatement.totals.totalExpenses).toBe(60_000)
    expect(fy2024.incomeStatement.totals.totalExpenses).toBe(45_000)
  })

  it('leaves totals that simply do not add up to the other checks', () => {
    const a = column([40_000, 20_000], 61_000)
    const b = column([30_000, 15_000], 45_000)
    expect(fixSwappedTotals(a, b)).toBe(false)
    expect(a.incomeStatement.totals.totalExpenses).toBe(61_000)
  })

  it('leaves correct totals alone', () => {
    const a = column([40_000, 20_000], 60_000)
    const b = column([30_000, 15_000], 45_000)
    expect(fixSwappedTotals(a, b)).toBe(false)
  })
})
