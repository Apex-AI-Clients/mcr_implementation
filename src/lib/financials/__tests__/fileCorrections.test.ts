import { describe, it, expect } from 'vitest'
import { computeFinancialsComparison } from '../computeComparison'
import { correctFile, finalLineNotes, type FileColumn } from '../lineCorrections'
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
      // "Business Loan - Ondesk" is printed with "-": it exists and is $0.
      expect(col.balanceSheet.nonCurrentLiabilities).toEqual({ directorRelatedLoansPayable: loan, chattelMortgages: 12_000, loansAndFinance: 0 })
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
    const ctx = { isTrust: true, directors: [] }
    correctFile([fy2024, fy2023], ctx, null)
    // Notes come from the final mapping, as the comparison build makes them.
    for (const notes of [finalLineNotes(fy2024.lines, ctx), finalLineNotes(fy2023.lines, ctx)]) {
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
    const pageLines = { is: [], bs: ['Equity', 'Retained Profits 139,668 -'], columns: 1 }
    const { columnNotes } = correctFile([col], { isTrust: false }, pageLines)
    expect(col.lines[0].value).toBe(-139_668)
    expect(col.balanceSheet.equity.retainedEarnings).toBe(-139_668)
    expect(columnNotes[0].map((n) => n.kind)).toContain('sign_corrected')
  })

  it('leaves a line alone when the printed line is ambiguous', () => {
    const fy2025 = column(0, [line('incomeTotals', 'Net Profit', 4_682, 'totals.profitBeforeTax', true)], {}, { totals: { profitBeforeTax: 4_682 } })
    const fy2024 = column(1, [line('incomeTotals', 'Net Profit', 7_100, 'totals.profitBeforeTax', true)], {}, { totals: { profitBeforeTax: 7_100 } })
    correctFile([fy2025, fy2024], { isTrust: false }, { is: ['Net Profit 4,682 - 7,100'], bs: [], columns: 2 })
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

describe('every line checked against the printed row (row misalignment)', () => {
  // "Profit and Loss 23-24.pdf" layout: FY2024 then FY2023, "-" for nil.
  const printedRows = [
    'Wages - -',
    'Superannuation - 1,137',
    'Telephone - 6,540',
    'Training 6,700 -',
    'Travel - Work Event 2,016 -',
    'Total Expenses 8,716 7,677',
  ]
  const expenses = (index: number, values: Record<string, number | null>) =>
    column(
      index,
      [
        line('expenses', 'Wages', values.wages, 'expenses.wagesAndSalaries'),
        line('expenses', 'Superannuation', values.super, 'expenses.superannuation'),
        line('expenses', 'Telephone', values.phone, 'expenses.telephoneAndInternet'),
        line('expenses', 'Training', values.training, 'expenses.trainingAndDevelopment'),
        line('expenses', 'Travel - Work Event', values.travel, 'expenses.travelAndAccommodation'),
        line('expenses', 'Total Expenses', index === 0 ? 8_716 : 7_677, 'totals.totalExpenses', true),
      ],
      {},
      { totals: { totalExpenses: index === 0 ? 8_716 : 7_677 } },
    )

  it('puts each figure back on its own row, from the printed statement', () => {
    // What the model returned: every figure slid onto a neighbouring row.
    const fy2024 = expenses(0, { wages: null, super: 6_700, phone: null, training: 2_016, travel: null })
    const fy2023 = expenses(1, { wages: 6_540, super: 1_137, phone: null, training: null, travel: null })
    const { columnNotes } = correctFile([fy2024, fy2023], { isTrust: true }, { is: printedRows, bs: [], columns: 2 })

    expect(fy2024.incomeStatement.expenses).toEqual({
      wagesAndSalaries: 0,
      superannuation: 0,
      telephoneAndInternet: 0,
      trainingAndDevelopment: 6_700,
      travelAndAccommodation: 2_016,
    })
    expect(fy2023.incomeStatement.expenses).toEqual({
      wagesAndSalaries: 0,
      superannuation: 1_137,
      telephoneAndInternet: 6_540,
      trainingAndDevelopment: 0,
      travelAndAccommodation: 0,
    })
    expect(columnNotes[0].filter((n) => n.kind === 'value_corrected')).toHaveLength(3)
    expect(columnNotes[1].filter((n) => n.kind === 'value_corrected')).toHaveLength(2)
    expect(columnNotes[0].map((n) => n.message)).toContain(
      '"Training" was read as $2,016, but the statement prints $6,700 on that row. The printed figure was used.',
    )
  })

  it('keeps the model value when the printed row cannot be read without guessing', () => {
    const fy2025 = column(0, [line('expenses', 'Rent', 4_682, 'expenses.rent')], {}, { expenses: { rent: 4_682 } })
    const fy2024 = column(1, [line('expenses', 'Rent', 7_100, 'expenses.rent')], {}, { expenses: { rent: 7_100 } })
    correctFile([fy2025, fy2024], { isTrust: false }, { is: ['Rent 4,682 - 7,100'], bs: [], columns: 2 })
    expect(fy2025.incomeStatement.expenses.rent).toBe(4_682)
    expect(fy2024.incomeStatement.expenses.rent).toBe(7_100)
  })
})

describe('printed "-" is $0; a missing line stays empty', () => {
  it('stores 0 for a line printed with "-", and nothing for a line the year does not have', () => {
    const col = column(0, [
      line('equity', 'Retained Profits', null, 'equity.retainedEarnings'),
      line('equity', 'Settled Sum', 10, 'equity.other'),
      line('currentAssets', 'Cash at Bank', 10, 'currentAssets.bankAccounts'),
    ])
    correctFile([col], { isTrust: true }, null)
    expect(col.balanceSheet.equity.retainedEarnings).toBe(0)
    expect(col.balanceSheet.currentAssets.accountsReceivable).toBeUndefined()
  })
})

describe('distributions to beneficiaries', () => {
  const appropriation = (heading: number | null) =>
    column(
      0,
      [
        line('incomeTotals', 'Net Profit', 16_996, 'totals.profitBeforeTax', true),
        line('appropriation', 'DISTRIBUTION TO BENEFICIARIES', heading, null),
        line('appropriation', 'Anh Bao Citizen', 8_498, null),
        line('appropriation', 'Binh Citizen', 8_498, null),
        line('appropriation', 'UNDISTRIBUTED INCOME', null, null),
      ],
      {},
      { totals: { profitBeforeTax: 16_996 } },
    )

  it('adds up the named beneficiary lines under the heading', () => {
    const col = appropriation(null)
    correctFile([col], { isTrust: true }, null)
    expect(col.incomeStatement.appropriations?.distributions).toBe(16_996)
  })

  it('takes the printed heading figure when it carries one', () => {
    const col = appropriation(16_996)
    correctFile([col], { isTrust: true }, null)
    expect(col.incomeStatement.appropriations?.distributions).toBe(16_996)
  })

  it('reads distributions printed in a balance sheet equity section as equity.distributions', () => {
    const col = column(0, [line('equity', 'Distributions to Beneficiaries', 16_996, 'equity.other')])
    correctFile([col], { isTrust: true }, null)
    expect((col.balanceSheet.equity as Record<string, number>).distributions).toBe(16_996)
  })
})
