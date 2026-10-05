import { describe, it, expect } from 'vitest'
import { computeFinancialsComparison } from '../computeComparison'
import { correctFile, type FileColumn } from '../lineCorrections'
import type {
  ExtractedBalanceSheet,
  ExtractedFinancialStatement,
  ExtractedIncomeStatement,
  LineSection,
  StatementLine,
} from '../types'

/**
 * correctFile(): every column of one file, the same way. SYNTHETIC figures in
 * the layouts seen in real files — a two-column trust balance sheet with its
 * totals printed in the wrong column, a P&L with amortisation, and a
 * PARKCON-style combined statement with vehicle finance.
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

const column = (index: number, lines: StatementLine[], bs: Partial<ExtractedBalanceSheet> = {}, is: Partial<ExtractedIncomeStatement> = {}): FileColumn => ({
  index,
  lines,
  incomeStatement: { ...blankIs(), ...is },
  balanceSheet: { ...blankBs(), ...bs },
})

const DIRECTORS = ['Anh Bao Citizen'] // invented

/**
 * A trust balance sheet, FY2024 and FY2023 columns. The model filed the bond
 * as property, plant & equipment in the comparative column only, and the
 * director's loan as "other" in both. The printed section totals sit in the
 * WRONG column.
 */
function trustBalanceSheet() {
  const bsLines = (bank: number, fittings: number, bond: number, loan: number, wrongTotals: { nca: number; ncl: number }) => [
    line('currentAssets', 'Cash at Bank', bank, 'currentAssets.bankAccounts'),
    line('nonCurrentAssets', 'Shop Fittings', fittings, 'nonCurrentAssets.propertyPlantEquipment'),
    line('nonCurrentAssets', 'Bond Rent', bond, 'nonCurrentAssets.propertyPlantEquipment'),
    line('nonCurrentAssets', 'Total Non-Current Assets', wrongTotals.nca, 'totals.totalNonCurrentAssets', true),
    line('nonCurrentLiabilities', 'Loan - Anh Bao Citizen', loan, 'nonCurrentLiabilities.other'),
    line('nonCurrentLiabilities', 'Business Loan - Ondesk', null, 'nonCurrentLiabilities.other'),
    line('nonCurrentLiabilities', 'Loan - Audi', 12_000, 'nonCurrentLiabilities.other'),
    line('nonCurrentLiabilities', 'Total Non-Current Liabilities', wrongTotals.ncl, 'totals.totalNonCurrentLiabilities', true),
    line('equity', 'Retained Profits', bank + fittings + bond - loan - 12_000, 'equity.retainedEarnings'),
  ]
  // FY2024: fittings 40,000 + bond 6,050 = 46,050; liabilities 30,000 + 12,000 = 42,000.
  // FY2023: fittings 44,000 + bond 6,050 = 50,050; liabilities 25,000 + 12,000 = 37,000.
  const fy2024 = column(
    0,
    bsLines(20_000, 40_000, 6_050, 30_000, { nca: 50_050, ncl: 37_000 }),
    { nonCurrentAssets: { propertyPlantEquipment: 40_000, other: { 'Bond Rent': 6_050 } } as never, nonCurrentLiabilities: { other: { 'Loan - Anh Bao Citizen': 30_000, 'Loan - Audi': 12_000 } } as never },
  )
  const fy2023 = column(
    1,
    bsLines(15_000, 44_000, 6_050, 25_000, { nca: 46_050, ncl: 42_000 }),
    { nonCurrentAssets: { propertyPlantEquipment: 50_050 }, nonCurrentLiabilities: { other: { 'Loan - Anh Bao Citizen': 25_000, 'Loan - Audi': 12_000 } } as never },
  )
  return [fy2024, fy2023]
}

describe('section rebuild from complete line lists', () => {
  it('rebuilds both columns the same way when the printed totals are in the wrong column', () => {
    const [fy2024, fy2023] = trustBalanceSheet()
    correctFile([fy2024, fy2023], { isTrust: true, directors: DIRECTORS }, null)

    for (const [col, fittings, loan] of [
      [fy2024, 40_000, 30_000],
      [fy2023, 44_000, 25_000],
    ] as const) {
      expect(col.balanceSheet.nonCurrentAssets).toEqual({ propertyPlantEquipment: fittings, other: { Deposits: 6_050 } })
      expect(col.balanceSheet.nonCurrentLiabilities).toEqual({ directorRelatedLoansPayable: loan, chattelMortgages: 12_000 })
    }
  })

  it('accepts totals printed in the other column as proof the lines are complete (no equity lines to balance)', () => {
    // Only sections with printed totals, each total printed in the other column.
    const sheet = (index: number, fittings: number, nca: number) =>
      column(
        index,
        [
          line('nonCurrentAssets', 'Shop Fittings', fittings, 'nonCurrentAssets.propertyPlantEquipment'),
          line('nonCurrentAssets', 'Bond Rent', 6_050, 'nonCurrentAssets.propertyPlantEquipment'),
          line('nonCurrentAssets', 'Total Non-Current Assets', nca, 'totals.totalNonCurrentAssets', true),
        ],
        { nonCurrentAssets: { propertyPlantEquipment: fittings + 6_050 } },
      )
    const fy2024 = sheet(0, 40_000, 50_050) // its own lines add to 46,050
    const fy2023 = sheet(1, 44_000, 46_050) // its own lines add to 50,050
    const { columnNotes } = correctFile([fy2024, fy2023], { isTrust: false }, null)
    expect(fy2024.balanceSheet.nonCurrentAssets).toEqual({ propertyPlantEquipment: 40_000, other: { Deposits: 6_050 } })
    expect(fy2023.balanceSheet.nonCurrentAssets).toEqual({ propertyPlantEquipment: 44_000, other: { Deposits: 6_050 } })
    expect(columnNotes.flat().map((n) => n.kind)).not.toContain('lines_incomplete')
  })

  it('counts a balance sheet as complete when it balances from its lines, with no printed totals at all', () => {
    const lines = [
      line('currentAssets', 'Cash at Bank', 10_000, 'currentAssets.bankAccounts'),
      line('nonCurrentAssets', 'Bond', 2_000, 'nonCurrentAssets.propertyPlantEquipment'),
      line('currentLiabilities', 'GST Payable', 3_000, 'currentLiabilities.gstPayable'),
      line('equity', 'Retained Profits', 9_000, 'equity.retainedEarnings'),
    ]
    const col = column(0, lines, { nonCurrentAssets: { propertyPlantEquipment: 2_000 } })
    correctFile([col], { isTrust: false }, null)
    expect(col.balanceSheet.nonCurrentAssets).toEqual({ other: { Deposits: 2_000 } })
  })

  it('keeps the model figures, with a note, when the lines do not add up', () => {
    const lines = [
      line('currentAssets', 'Cash at Bank', 10_000, 'currentAssets.bankAccounts'),
      line('currentAssets', 'Total Current Assets', 99_000, 'totals.totalCurrentAssets', true),
    ]
    const col = column(0, lines, { currentAssets: { bankAccounts: 10_000, accountsReceivable: 89_000 } })
    const { columnNotes } = correctFile([col], { isTrust: false }, null)
    expect(col.balanceSheet.currentAssets).toEqual({ bankAccounts: 10_000, accountsReceivable: 89_000 })
    expect(columnNotes[0].map((n) => n.kind)).toContain('lines_incomplete')
  })
})

describe('notes from the lines', () => {
  it('raises the same notes for both columns, and none for dictionary-mapped lines', () => {
    const [fy2024, fy2023] = trustBalanceSheet()
    const { columnNotes } = correctFile([fy2024, fy2023], { isTrust: true, directors: [] }, null)
    for (const notes of columnNotes) {
      // Without a director on file the person loan is not assumed: one note per column.
      expect(notes.filter((n) => n.kind === 'loan_unconfirmed').map((n) => n.message)).toEqual([
        "Loan 'Loan - Anh Bao Citizen': director or lender? Confirm. It is shown under loans & finance until confirmed.",
      ])
      // Bond Rent goes to deposits by the dictionary: no "not a standard line" note.
      expect(notes.filter((n) => n.kind === 'unmapped_line_item')).toEqual([])
    }
  })
})

describe('amortisation', () => {
  it('folds amortisation into depreciation in every column', () => {
    const p = (amort: number, index: number) =>
      column(
        index,
        [
          line('income', 'Sales', 100_000, 'income.sales'),
          line('expenses', 'Depreciation', 5_000, 'expenses.depreciation'),
          line('expenses', 'Amortisation', amort, 'expenses.other'),
          line('expenses', 'Total Expenses', 5_000 + amort, 'totals.totalExpenses', true),
        ],
        {},
        { income: { sales: 100_000 }, expenses: { depreciation: 5_000, other: { Amortisation: amort } } as never },
      )
    const fy2025 = p(2_892, 0)
    const fy2024 = p(2_892, 1)
    correctFile([fy2025, fy2024], { isTrust: true }, null)
    for (const col of [fy2025, fy2024]) expect(col.incomeStatement.expenses).toEqual({ depreciation: 7_892 })
  })
})

describe('printed signs', () => {
  it('takes the sign the PDF prints with a trailing minus', () => {
    const col = column(
      0,
      [line('equity', 'Retained Profits', 139_668, 'equity.retainedEarnings')],
      { equity: { retainedEarnings: 139_668 } },
    )
    const pageLines = { is: [], bs: ['Equity', 'Retained Profits 139,668 -'] }
    const { columnNotes } = correctFile([col], { isTrust: false }, pageLines)
    expect(col.lines[0].value).toBe(-139_668)
    expect(col.balanceSheet.equity.retainedEarnings).toBe(-139_668)
    expect(columnNotes[0].map((n) => n.kind)).toContain('sign_corrected')
  })

  it('leaves a line alone when the printed line is ambiguous', () => {
    const fy2025 = column(0, [line('incomeTotals', 'Net Profit', 4_682, 'totals.profitBeforeTax', true)], {}, { totals: { profitBeforeTax: 4_682 } })
    const fy2024 = column(1, [line('incomeTotals', 'Net Profit', 7_100, 'totals.profitBeforeTax', true)], {}, { totals: { profitBeforeTax: 7_100 } })
    correctFile([fy2025, fy2024], { isTrust: false }, { is: ['Net Profit 4,682 - 7,100'], bs: [] })
    expect(fy2025.incomeStatement.totals.profitBeforeTax).toBe(4_682)
  })
})

describe('regression: PARKCON-style combined statement', () => {
  /**
   * A company with vehicle and equipment finance, unexpired interest netted,
   * year-suffixed director loans, and an income tax line — all already mapped
   * correctly by the model. The corrections must leave its figures, and the
   * comparison built from them, exactly as they were.
   */
  function parkconStyle(year: number, index: number, scale: number): { col: FileColumn; statement: ExtractedFinancialStatement } {
    const v = (n: number) => Math.round(n * scale)
    const lines = [
      line('income', 'Sales', v(1_200_000), 'income.sales'),
      line('income', 'Total Income', v(1_200_000), 'totals.totalIncome', true),
      line('cogs', 'Purchases', v(500_000), 'cogs.purchases'),
      line('cogs', 'Total Cost of Sales', v(500_000), 'totals.totalCogs', true),
      line('expenses', 'Wages and Salaries', v(300_000), 'expenses.wagesAndSalaries'),
      line('expenses', 'Depreciation', v(40_000), 'expenses.depreciation'),
      line('expenses', 'Total Expenses', v(340_000), 'totals.totalExpenses', true),
      line('incomeTotals', 'Profit before income tax', v(360_000), 'totals.profitBeforeTax', true),
      line('incomeTax', 'Income tax expense', v(90_000), null),
      line('incomeTotals', 'Profit after income tax', v(270_000), 'totals.netProfitAfterTax', true),
      line('currentAssets', 'Cash at Bank', v(150_000), 'currentAssets.bankAccounts'),
      line('currentAssets', 'Trade Debtors', v(100_000), 'currentAssets.accountsReceivable'),
      line('currentAssets', 'Total Current Assets', v(250_000), 'totals.totalCurrentAssets', true),
      line('nonCurrentAssets', 'Plant & Equipment', v(400_000), 'nonCurrentAssets.propertyPlantEquipment'),
      line('nonCurrentAssets', 'Loan 2020', v(60_000), 'nonCurrentAssets.directorRelatedLoansReceivable'),
      line('nonCurrentAssets', 'Total Non-Current Assets', v(460_000), 'totals.totalNonCurrentAssets', true),
      line('currentLiabilities', 'ATO Integrated Client Account', v(120_000), 'currentLiabilities.atoLiability'),
      line('currentLiabilities', 'Total Current Liabilities', v(120_000), 'totals.totalCurrentLiabilities', true),
      line('nonCurrentLiabilities', 'Loan - VW', v(40_000), 'nonCurrentLiabilities.chattelMortgages'),
      line('nonCurrentLiabilities', 'Loan - Hino Truck', v(90_000), 'nonCurrentLiabilities.chattelMortgages'),
      line('nonCurrentLiabilities', 'Less Unexpired Interest - Hino Truck', v(-10_000), 'nonCurrentLiabilities.chattelMortgages'),
      line('nonCurrentLiabilities', 'Loan - Mini Excavator', v(30_000), 'nonCurrentLiabilities.chattelMortgages'),
      line('nonCurrentLiabilities', 'Total Non-Current Liabilities', v(150_000), 'totals.totalNonCurrentLiabilities', true),
      line('equity', 'Share Capital', v(100), 'equity.shareCapital'),
      line('equity', 'Retained Earnings', v(440_000) - v(100), 'equity.retainedEarnings'),
    ]
    const statement: ExtractedFinancialStatement = {
      financialYear: year,
      periodEndDate: `${year}-06-30`,
      sourceFilename: `SYNTH_Tax ${year + (index === 0 ? 0 : 1)}.pdf`,
      sourceColumn: index === 0 ? 'primary' : 'comparative',
      incomeStatement: {
        income: { sales: v(1_200_000) },
        cogs: { purchases: v(500_000) },
        expenses: { wagesAndSalaries: v(300_000), depreciation: v(40_000) },
        totals: {
          totalIncome: v(1_200_000),
          totalCogs: v(500_000),
          totalExpenses: v(340_000),
          profitBeforeTax: v(360_000),
          netProfitAfterTax: v(270_000),
        },
      },
      balanceSheet: {
        currentAssets: { bankAccounts: v(150_000), accountsReceivable: v(100_000) },
        nonCurrentAssets: { propertyPlantEquipment: v(400_000), directorRelatedLoansReceivable: v(60_000) },
        currentLiabilities: { atoLiability: v(120_000) },
        nonCurrentLiabilities: { chattelMortgages: v(40_000) + v(90_000) + v(-10_000) + v(30_000) },
        equity: { shareCapital: v(100), retainedEarnings: v(440_000) - v(100) },
        totals: {
          totalCurrentAssets: v(250_000),
          totalNonCurrentAssets: v(460_000),
          totalAssets: v(710_000),
          totalCurrentLiabilities: v(120_000),
          totalNonCurrentLiabilities: v(150_000),
          totalLiabilities: v(270_000),
          netAssets: v(440_000),
          totalEquity: v(440_000),
        },
      },
      rawExtraction: [],
      warnings: [],
    }
    const copy = structuredClone(statement)
    return { col: { index, lines, incomeStatement: copy.incomeStatement, balanceSheet: copy.balanceSheet }, statement }
  }

  it('leaves correctly mapped figures and the comparison unchanged', () => {
    const before: ExtractedFinancialStatement[] = []
    const after: ExtractedFinancialStatement[] = []
    for (const [primaryYear, scale] of [
      [2025, 1],
      [2024, 0.9],
    ] as const) {
      const primary = parkconStyle(primaryYear, 0, scale)
      const comparative = parkconStyle(primaryYear - 1, 1, scale * 0.95)
      const { columnNotes } = correctFile([primary.col, comparative.col], { isTrust: false, directors: ['Sam Sample'] }, null)
      for (const notes of columnNotes) {
        expect(notes.map((n) => n.kind)).toEqual([])
      }
      for (const [orig, col] of [
        [primary.statement, primary.col],
        [comparative.statement, comparative.col],
      ] as const) {
        expect(col.incomeStatement).toMatchObject({ income: orig.incomeStatement.income, cogs: orig.incomeStatement.cogs, expenses: orig.incomeStatement.expenses, totals: orig.incomeStatement.totals })
        expect(col.balanceSheet).toMatchObject({
          currentAssets: orig.balanceSheet.currentAssets,
          nonCurrentAssets: orig.balanceSheet.nonCurrentAssets,
          currentLiabilities: orig.balanceSheet.currentLiabilities,
          nonCurrentLiabilities: orig.balanceSheet.nonCurrentLiabilities,
          equity: orig.balanceSheet.equity,
        })
        before.push(orig)
        after.push({ ...orig, incomeStatement: col.incomeStatement, balanceSheet: col.balanceSheet })
      }
    }
    const primaries = (list: ExtractedFinancialStatement[]) => list.filter((s) => s.sourceColumn === 'primary')
    expect(computeFinancialsComparison(primaries(after))).toEqual(computeFinancialsComparison(primaries(before)))
  })
})
