import { describe, it, expect } from 'vitest'
import { computeFinancialsComparison } from '../computeComparison'
import { correctFile, distributionsFromLines, fixSwappedTotals, principalFor, reconcileSubtotals, type Column, type FileColumn } from '../lineCorrections'
import { mergeAnnualYears } from '../statementSelection'
import { harmoniseMappings, invariantBreaches } from '../mappingConsistency'
import type {
  ExtractedBalanceSheet,
  ExtractedIncomeStatement,
  LineSection,
  StatementLine,
  StoredStatementSlot,
} from '../types'

/**
 * Balance sheet layouts like the PARKCON current-period statement and the
 * year files: separate "Fixed Assets" headings, overdrawn bank accounts,
 * finance with its unexpired interest. SYNTHETIC figures throughout.
 */

const line = (section: LineSection, rawLabel: string, value: number | null, canonicalKey: string | null, isTotal = false): StatementLine => ({
  section,
  rawLabel,
  value,
  canonicalKey,
  isTotal,
})

const blankIs = (): ExtractedIncomeStatement => ({ income: {}, cogs: {}, expenses: {}, totals: {} })
const bs = (p: Partial<ExtractedBalanceSheet> = {}): ExtractedBalanceSheet => ({
  currentAssets: {},
  nonCurrentAssets: {},
  currentLiabilities: {},
  nonCurrentLiabilities: {},
  equity: {},
  totals: {},
  ...p,
})
const column = (index: number, lines: StatementLine[], b: Partial<ExtractedBalanceSheet>): FileColumn => ({
  index,
  lines,
  incomeStatement: blankIs(),
  balanceSheet: bs(b),
})

describe('the invariant compares a figure with its gross section, not the net total (item 1)', () => {
  it('accepts opening stock above total cost of sales (closing stock is subtracted)', () => {
    const is: ExtractedIncomeStatement = {
      income: {},
      cogs: { openingStock: 50_000, purchases: 30_000, closingStock: 30_200 },
      expenses: {},
      totals: { totalCogs: 49_800 },
      lines: [
        line('cogs', 'Opening Stock', 50_000, 'cogs.openingStock'),
        line('cogs', 'Purchases', 30_000, 'cogs.purchases'),
        line('cogs', 'Closing Stock', -30_200, 'cogs.closingStock'),
      ],
    }
    expect(invariantBreaches('income_statement', is)).toEqual([])
  })

  it('accepts chattel mortgages above a non-current liabilities total netted down by negative director loans', () => {
    const sheet = bs({
      nonCurrentAssets: { directorRelatedLoansReceivable: 29_000 },
      nonCurrentLiabilities: { chattelMortgages: 140_000 },
      totals: { totalNonCurrentLiabilities: 111_000 },
      lines: [
        line('nonCurrentLiabilities', 'Loan - Hino Truck', 90_000, 'nonCurrentLiabilities.chattelMortgages'),
        line('nonCurrentLiabilities', 'Loan - Mini Excavator', 70_000, 'nonCurrentLiabilities.chattelMortgages'),
        line('nonCurrentLiabilities', 'Loan - Hino Truck Unexpired Interest', -20_000, 'nonCurrentLiabilities.chattelMortgages'),
        line('nonCurrentLiabilities', 'Loan 2019', -7_000, 'nonCurrentAssets.directorRelatedLoansReceivable'),
        line('nonCurrentLiabilities', 'Loan 2020', -22_000, 'nonCurrentAssets.directorRelatedLoansReceivable'),
      ],
    })
    expect(invariantBreaches('balance_sheet', sheet)).toEqual([])
  })

  it('still catches a figure larger than every line of its section together', () => {
    const sheet = bs({
      nonCurrentLiabilities: { chattelMortgages: 50_000 },
      totals: { totalNonCurrentLiabilities: 10_000 },
      lines: [line('nonCurrentLiabilities', 'Chattel Mortgage', 10_000, 'nonCurrentLiabilities.chattelMortgages')],
    })
    expect(invariantBreaches('balance_sheet', sheet)).toEqual([
      'chattel mortgages $50,000 is more than all its non current liabilities lines together ($10,000)',
    ])
  })
})

describe('current-period layout with separate headings (item 2)', () => {
  // Bank / Current Assets / Fixed Assets / Non-current Assets, each with its
  // own subtotal; "Total Non-current Assets" covers the loans only.
  const lines = (loans: number, rounding: number) => [
    line('currentAssets', 'Cheque Account', 6_000, 'currentAssets.bankAccounts'),
    line('currentAssets', 'Trade Debtors', 14_000, 'currentAssets.accountsReceivable'),
    line('currentAssets', 'Total Current Assets', 14_000, 'totals.totalCurrentAssets', true),
    line('nonCurrentAssets', 'Plant & Equipment', 140_000, 'nonCurrentAssets.propertyPlantEquipment'),
    line('nonCurrentAssets', 'Total Fixed Assets', 140_000, null, true),
    line('nonCurrentAssets', 'Loan 2020 (Quarantined)', loans, 'nonCurrentAssets.directorRelatedLoansReceivable'),
    line('nonCurrentAssets', 'Total Non-current Assets', loans, 'totals.totalNonCurrentAssets', true),
    line('currentLiabilities', 'GST', 200_000, 'currentLiabilities.gstPayable'),
    line('currentLiabilities', 'Rounding', rounding, 'currentLiabilities.other.Rounding'),
    line('currentLiabilities', 'Total Current Liabilities', 200_000 + rounding, 'totals.totalCurrentLiabilities', true),
  ]
  const figures = (loans: number, rounding: number): Partial<ExtractedBalanceSheet> => ({
    currentAssets: { bankAccounts: 6_000, accountsReceivable: 14_000 },
    nonCurrentAssets: { propertyPlantEquipment: 140_000, directorRelatedLoansReceivable: loans },
    currentLiabilities: { gstPayable: 200_000, other: { Rounding: rounding } } as never,
    totals: {
      totalCurrentAssets: 14_000,
      totalNonCurrentAssets: loans,
      totalAssets: 20_000 + 140_000 + loans,
      totalCurrentLiabilities: 200_000 + rounding,
      totalLiabilities: 200_000 + rounding,
    },
  })

  it('counts fixed assets as non-current, and does not take near-identical columns for swapped totals', () => {
    // The current period beside the year end: the same loans in both columns.
    const current = column(0, lines(148_000, -3_900), figures(148_000, -3_900))
    const yearEnd = column(1, lines(148_000, -3_900), figures(148_000, -3_900))
    const { columnNotes, fileNotes } = correctFile([current, yearEnd], { isTrust: false }, null)
    expect(fileNotes.filter((n) => n.kind === 'swapped_totals')).toEqual([])
    expect(current.balanceSheet.totals.totalNonCurrentAssets).toBe(288_000)
    expect(current.balanceSheet.totals.totalCurrentAssets).toBe(20_000)
    // Rounding counted once.
    expect(current.balanceSheet.totals.totalCurrentLiabilities).toBe(196_100)
    expect((current.balanceSheet.currentLiabilities as Record<string, unknown>).other).toEqual({ Rounding: -3_900 })
    expect(columnNotes[0].some((n) => n.group === 'subtotals')).toBe(true)
  })

  it('leaves subtotals that already add up to total assets alone', () => {
    const sheet = bs({
      currentAssets: { bankAccounts: 10 },
      nonCurrentAssets: { propertyPlantEquipment: 90 },
      totals: { totalCurrentAssets: 10, totalNonCurrentAssets: 90, totalAssets: 100 },
    })
    expect(reconcileSubtotals(sheet)).toEqual([])
  })

  it('still swaps totals that really are printed in each other column', () => {
    const own = (v: number[], printed: number): Column => ({
      incomeStatement: { ...blankIs(), totals: { totalExpenses: printed } },
      balanceSheet: bs(),
      lines: [...v.map((x, i) => line('expenses', `E${i}`, x, null)), line('expenses', 'Total Expenses', printed, 'totals.totalExpenses', true)],
    })
    const a = own([40_000, 20_000], 45_000)
    const b = own([30_000, 15_000], 60_000)
    expect(fixSwappedTotals(a, b)).toBe(true)
    // One-sided: b's printed total is its own — no swap.
    expect(fixSwappedTotals(own([40_000, 20_000], 45_000), own([30_000, 15_000], 45_000))).toBe(false)
  })
})

describe('an overdrawn bank account is never also cash (item 3)', () => {
  it('sets bank accounts to $0 when its own line prints "-" and the figure is the overdraft line\'s', () => {
    const col = column(
      0,
      [
        line('currentAssets', 'Business Account', null, 'currentAssets.bankAccounts'),
        line('currentAssets', 'Trade Debtors', 20_000, 'currentAssets.accountsReceivable'),
        // The model's own total counted the overdraft as cash too: the lines do not add up.
        line('currentAssets', 'Total Current Assets', 24_268, 'totals.totalCurrentAssets', true),
        line('currentLiabilities', 'Business Account', 4_268, 'currentLiabilities.bankOverdraft'),
        line('currentLiabilities', 'GST', 3_000, 'currentLiabilities.gstPayable'),
        line('currentLiabilities', 'Total Current Liabilities', 9_000, 'totals.totalCurrentLiabilities', true),
      ],
      {
        // The model also put the overdraft figure in bank accounts.
        currentAssets: { bankAccounts: 4_268, accountsReceivable: 20_000 },
        currentLiabilities: { bankOverdraft: 4_268, gstPayable: 3_000 },
        totals: { totalCurrentAssets: 24_268, totalCurrentLiabilities: 9_000 },
      },
    )
    const { columnNotes } = correctFile([col], { isTrust: false }, null)
    expect(col.balanceSheet.currentAssets.bankAccounts).toBe(0)
    expect(col.balanceSheet.currentLiabilities.bankOverdraft).toBe(4_268)
    expect(columnNotes[0].find((n) => n.group === 'nil_line')?.message).toMatch(/^Bank accounts was read as \$4,268/)
  })
})

describe('unexpired interest follows its loan (item 4)', () => {
  const vw = line('nonCurrentLiabilities', 'VW Finance', 19_000, 'nonCurrentLiabilities.loansAndFinance')
  const interest = line('nonCurrentLiabilities', 'Less Unexpired Interest - VW', -1_200, 'nonCurrentLiabilities.chattelMortgages')

  it('pairs the interest line with its loan by name', () => {
    const hino = line('nonCurrentLiabilities', 'Loan - Hino Truck', 50_000, 'nonCurrentLiabilities.chattelMortgages')
    const hinoInterest = line('nonCurrentLiabilities', 'Loan - Hino Truck Unexpired Interest', -3_000, null)
    expect(principalFor(interest, [vw, interest, hino, hinoInterest])).toBe(vw)
    expect(principalFor(hinoInterest, [vw, interest, hino, hinoInterest])).toBe(hino)
    expect(principalFor(vw, [vw, interest])).toBeNull()
  })

  it('maps both to the same key at extraction', () => {
    const col = column(
      0,
      [
        { ...vw },
        { ...interest },
        line('nonCurrentLiabilities', 'Total Non-Current Liabilities', 17_800, 'totals.totalNonCurrentLiabilities', true),
      ],
      { nonCurrentLiabilities: { loansAndFinance: 19_000, chattelMortgages: -1_200 }, totals: { totalNonCurrentLiabilities: 17_800 } },
    )
    correctFile([col], { isTrust: false }, null)
    expect(col.balanceSheet.nonCurrentLiabilities).toEqual({ loansAndFinance: 17_800 })
  })

  it('maps both to the same key across files, whatever the order', () => {
    const slot = (year: number, doc: string): StoredStatementSlot => ({
      id: `${year}`,
      financialYear: year,
      periodEndDate: `${year}-06-30`,
      periodStartDate: null,
      periodLabel: null,
      sourceColumn: 'primary',
      incomeStatement: null,
      balanceSheet: {
        data: bs({
          nonCurrentLiabilities: { loansAndFinance: 19_000, chattelMortgages: -1_200 },
          totals: { totalNonCurrentLiabilities: 17_800 },
          lines: [{ ...vw }, { ...interest }],
        }),
        documentId: doc,
        sourceFilename: `${doc}.pdf`,
        extractedAt: null,
        warnings: [],
      },
      slotWarnings: [],
      legacy: false,
      extractionModel: null,
    })
    for (const slots of [[slot(2022, 'a'), slot(2023, 'b')], [slot(2023, 'b'), slot(2022, 'a')]]) {
      harmoniseMappings(slots)
      for (const s of slots) expect(s.balanceSheet!.data.nonCurrentLiabilities).toEqual({ loansAndFinance: 17_800 })
    }
  })
})

describe('the FY2025 bank pattern read by the model (item 3, as stored)', () => {
  it('drops a heading that repeats its group total, and an overdraft read again as a negative bank balance', () => {
    const col = column(
      0,
      [
        line('currentAssets', 'Business Account', -4_000, 'currentAssets.bankAccounts'),
        line('currentAssets', 'Accounts Receivable', 60_000, 'currentAssets.accountsReceivable'),
        line('currentAssets', 'Total Current Assets', 60_000, 'totals.totalCurrentAssets', true),
        line('currentLiabilities', 'Bank overdraft', 4_000, 'currentLiabilities.bankOverdraft'),
        line('currentLiabilities', 'Business Account', 4_000, 'currentLiabilities.other'),
        line('currentLiabilities', 'Total Bank overdraft', 4_000, 'currentLiabilities.other', true),
        line('currentLiabilities', 'GST', 6_000, 'currentLiabilities.gstPayable'),
        line('currentLiabilities', 'Total Current Liabilities', 10_000, 'totals.totalCurrentLiabilities', true),
      ],
      {
        currentAssets: { bankAccounts: 4_000, accountsReceivable: 60_000 },
        currentLiabilities: { bankOverdraft: 4_000, gstPayable: 6_000 },
        totals: { totalCurrentAssets: 60_000, totalCurrentLiabilities: 10_000 },
      },
    )
    const { columnNotes } = correctFile([col], { isTrust: false }, null)
    expect(col.balanceSheet.currentAssets).toEqual({ bankAccounts: 0, accountsReceivable: 60_000 })
    expect(col.balanceSheet.currentLiabilities).toEqual({ bankOverdraft: 4_000, gstPayable: 6_000 })
    expect(columnNotes[0].map((n) => n.group)).toEqual(expect.arrayContaining(['heading', 'nil_line']))
    expect(columnNotes[0].some((n) => n.kind === 'lines_incomplete')).toBe(false)
  })
})

describe('printed "-" is $0 (verified-figures round)', () => {
  it('reads a distributions heading whose beneficiaries all print "-" as $0', () => {
    expect(
      distributionsFromLines([
        line('appropriation', 'DISTRIBUTION TO BENEFICIARIES:', null, null),
        line('appropriation', 'Beneficiary One', null, null),
        line('appropriation', 'Beneficiary Two', null, null),
      ]),
    ).toBe(0)
    expect(distributionsFromLines([line('appropriation', 'Net Profit', 100, null)])).toBeNull()
  })

  it("takes $0 for a line the year's own file does not print, from another file's \"-\" for that year", () => {
    const half = (data: ExtractedBalanceSheet, doc: string) => ({ data, documentId: doc, sourceFilename: `${doc}.pdf`, extractedAt: null, warnings: [] })
    const slot = (column: 'primary' | 'comparative', data: ExtractedBalanceSheet, doc: string): StoredStatementSlot => ({
      id: `2024-${column}`,
      financialYear: 2024,
      periodEndDate: '2024-06-30',
      periodStartDate: null,
      periodLabel: null,
      sourceColumn: column,
      incomeStatement: null,
      balanceSheet: half(data, doc),
      slotWarnings: [],
      legacy: false,
      extractionModel: null,
    })
    const [merged] = mergeAnnualYears([
      slot('primary', bs({ currentAssets: { bankAccounts: 9_000 } }), 'own'),
      slot('comparative', bs({ currentAssets: { bankAccounts: 9_500 }, currentLiabilities: { bankOverdraft: 0 } }), 'later'),
    ])
    expect(merged.statement.balanceSheet.currentLiabilities.bankOverdraft).toBe(0)
    // Amounts are never taken from the other file.
    expect(merged.statement.balanceSheet.currentAssets.bankAccounts).toBe(9_000)
  })

  it('shows a line printed "-" every year as $0 instead of hiding it', () => {
    const statement = (year: number) => ({
      financialYear: year,
      periodEndDate: `${year}-06-30`,
      sourceFilename: 'x.pdf',
      sourceColumn: 'primary',
      incomeStatement: { income: { sales: 100 }, cogs: {}, expenses: { wagesAndSalaries: 0 }, totals: { totalIncome: 100 } },
      balanceSheet: bs(),
      rawExtraction: [],
      warnings: [],
    })
    const c = computeFinancialsComparison([statement(2024), statement(2025)] as never)
    const wages = c.incomeStatementDiffs.flatMap((s) => s.rows).find((r) => r.canonicalKey === 'wagesAndSalaries')
    expect(wages?.valuesByYear).toEqual({ 2024: 0, 2025: 0 })
  })
})

describe('figures and total flags slid down a P&L column (re-extraction round)', () => {
  it('keeps categories with their labels, takes figures from the printed rows, and puts the totals back by label', () => {
    // As read: each figure one or two rows late; "Work Cover" flagged as the
    // expenses total; "Total expenses incurred" filed as net profit.
    const lines = [
      line('income', 'Sales', 300_000, 'income.sales'),
      line('income', 'Total Income', 300_000, 'totals.totalIncome', true),
      line('expenses', 'Legal Fee', 1_200, 'expenses.consultingAndAccounting'),
      line('expenses', 'Licence', 3_300, 'expenses.generalExpenses'),
      line('expenses', 'Telephone', 800, 'expenses.telephoneAndInternet'),
      line('expenses', 'Wages', 1_100, 'expenses.wagesAndSalaries'),
      line('expenses', 'Waste cleaning', 6_100, 'expenses.generalExpenses'),
      line('expenses', 'Work Cover', 293_900, 'totals.totalExpenses', true),
      line('incomeTotals', 'Total expenses incurred', 100, 'totals.netProfitAfterTax', true),
      line('incomeTotals', 'NET TRADING PROFIT /(LOSS)', null, null),
    ]
    const printedRows = [
      'Sales 300,000',
      'Total Income 300,000',
      'Legal Fee -',
      'Licence 1,200',
      'Telephone 3,300',
      'Wages -',
      'Waste cleaning 800',
      'Work Cover 1,100',
      'Total expenses incurred 6,400',
      'NET TRADING PROFIT /(LOSS) 293,600',
    ]
    const col = column(0, lines, {})
    col.incomeStatement = {
      income: { sales: 300_000 },
      cogs: {},
      expenses: { consultingAndAccounting: 1_200, generalExpenses: 9_400, telephoneAndInternet: 800, wagesAndSalaries: 1_100 },
      totals: { totalIncome: 300_000, totalExpenses: 6_400, profitBeforeTax: 293_600, netProfitAfterTax: 293_600 },
    }
    const { columnNotes } = correctFile([col], { isTrust: false }, { is: printedRows, bs: [], columns: 1 })
    const is = col.incomeStatement
    expect(is.totals.totalExpenses).toBe(6_400)
    expect(is.totals.profitBeforeTax).toBe(293_600)
    expect(is.expenses).toEqual({ consultingAndAccounting: 0, generalExpenses: 2_000, telephoneAndInternet: 3_300, wagesAndSalaries: 0, insurance: 1_100 })
    expect(columnNotes[0].some((n) => n.group === 'total_flags')).toBe(true)
    expect(columnNotes[0].some((n) => n.kind === 'lines_incomplete')).toBe(false)
  })
})
