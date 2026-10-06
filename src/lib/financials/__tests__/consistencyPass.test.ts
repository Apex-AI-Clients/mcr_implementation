import { describe, it, expect } from 'vitest'
import { classifyLoan, isDirectorLoanLabel } from '../labels'
import { correctFile, effectiveKey, CURRENT_ASSET_FINANCE, type FileColumn } from '../lineCorrections'
import { harmoniseMappings } from '../mappingConsistency'
import type {
  ExtractedBalanceSheet,
  ExtractedIncomeStatement,
  FinancialStatementSourceColumn,
  LineSection,
  StatementLine,
  StoredStatementSlot,
} from '../types'

/**
 * The cross-file consistency pass and the loan rules, on layouts like the
 * PARKCON statements. SYNTHETIC figures throughout.
 */

const line = (section: LineSection, rawLabel: string, value: number | null, canonicalKey: string | null, isTotal = false): StatementLine => ({
  section,
  rawLabel,
  value,
  canonicalKey,
  isTotal,
})

const bs = (p: Partial<ExtractedBalanceSheet>, lines: StatementLine[]): ExtractedBalanceSheet => ({
  currentAssets: {},
  nonCurrentAssets: {},
  currentLiabilities: {},
  nonCurrentLiabilities: {},
  equity: {},
  totals: {},
  ...p,
  lines,
})

function slot(year: number, column: FinancialStatementSourceColumn, data: ExtractedBalanceSheet, doc: string): StoredStatementSlot {
  return {
    id: `${year}-${column}`,
    financialYear: year,
    periodEndDate: `${year}-06-30`,
    periodStartDate: null,
    periodLabel: null,
    sourceColumn: column,
    incomeStatement: null,
    balanceSheet: { data, documentId: doc, sourceFilename: `${doc}.pdf`, extractedAt: null, warnings: [] },
    slotWarnings: [],
    legacy: false,
    extractionModel: null,
  }
}

/** A statement's figures, without its line list (whose order is the input's). */
const figures = (s: StoredStatementSlot) => ({ ...s.balanceSheet!.data, lines: undefined })

describe('the same label under different sections is a different line (item 2)', () => {
  it('makes only the year printed under liabilities an overdraft', () => {
    const slots = [
      slot(2025, 'primary', bs({ currentLiabilities: { bankOverdraft: 4_000 }, totals: { totalCurrentLiabilities: 4_000 } }, [
        line('currentAssets', 'Business Account', null, 'currentAssets.bankAccounts'),
        line('currentLiabilities', 'Business Account', 4_000, 'currentLiabilities.bankOverdraft'),
      ]), 'fy25'),
      slot(2024, 'primary', bs({ currentAssets: { bankAccounts: 20_000 }, totals: { totalCurrentAssets: 20_000 } }, [line('currentAssets', 'Business Account', 20_000, 'currentAssets.bankAccounts')]), 'fy24'),
      slot(2023, 'primary', bs({ currentAssets: { bankAccounts: 17_000 }, totals: { totalCurrentAssets: 17_000 } }, [line('currentAssets', 'Business Account', 17_000, 'currentAssets.bankAccounts')]), 'fy23'),
    ]
    const checks = harmoniseMappings(slots)
    expect(slots[0].balanceSheet!.data.currentLiabilities.bankOverdraft).toBe(4_000)
    expect(slots[1].balanceSheet!.data.currentAssets.bankAccounts).toBe(20_000)
    expect(slots[1].balanceSheet!.data.currentLiabilities.bankOverdraft).toBeUndefined()
    expect(slots[2].balanceSheet!.data.currentAssets.bankAccounts).toBe(17_000)
    expect(checks).toEqual([])
  })
})

describe('vehicle finance: current and non-current portions stay apart (item 3, b)', () => {
  it('never classes unexpired interest or charges as a director loan', () => {
    expect(isDirectorLoanLabel('Loan - Hino Truck Unexpired Interest')).toBe(false)
    expect(isDirectorLoanLabel('Loan - 2023 Unexpired Interest')).toBe(false)
    expect(isDirectorLoanLabel('Loan 2020 Interest')).toBe(false)
    expect(isDirectorLoanLabel('Loan - 2023 Charges')).toBe(false)
    expect(classifyLoan('Less Unexpired Interest - VW')).toBe('lender_asset')
    expect(classifyLoan('Less Unexpired Interest - Landcruiser Truck')).toBe('lender_asset')
    expect(classifyLoan('Less Unexpired Interest')).toBe('lender')
    // Still director loans:
    expect(isDirectorLoanLabel('Loan - 2023 (Quarantined)')).toBe(true)
    expect(isDirectorLoanLabel('Loan 2019')).toBe(true)
  })

  it('nets negative unexpired interest into chattel mortgages, never a receivable', () => {
    const ek = effectiveKey(line('nonCurrentLiabilities', 'Loan - Hino Truck Unexpired Interest', -3_000, null), { isTrust: false })
    expect(ek).toMatchObject({ key: 'nonCurrentLiabilities.chattelMortgages', source: 'loan' })
    expect(ek.absolute).toBeFalsy()
  })

  it('keeps the current portion (and its interest) in current liabilities', () => {
    const ctx = { isTrust: false }
    expect(effectiveKey(line('currentLiabilities', 'Loan - VW', 30_000, 'nonCurrentLiabilities.loansAndFinance'), ctx).key).toBe(
      `currentLiabilities.other.${CURRENT_ASSET_FINANCE}`,
    )
    expect(effectiveKey(line('currentLiabilities', 'Loan - VW Unexpired Interest', -2_000, null), ctx).key).toBe(
      `currentLiabilities.other.${CURRENT_ASSET_FINANCE}`,
    )
    expect(effectiveKey(line('nonCurrentLiabilities', 'Loan - VW', 50_000, null), ctx).key).toBe('nonCurrentLiabilities.chattelMortgages')
  })

  it('leaves chattel mortgages within total non-current liabilities when a loan is printed in both sections', () => {
    const lines = [
      line('currentLiabilities', 'Loan - Hino Truck', 30_000, 'nonCurrentLiabilities.chattelMortgages'),
      line('currentLiabilities', 'Loan - Hino Truck Unexpired Interest', -3_000, 'nonCurrentLiabilities.chattelMortgages'),
      line('nonCurrentLiabilities', 'Loan - Hino Truck', 100_000, 'nonCurrentLiabilities.chattelMortgages'),
      line('nonCurrentLiabilities', 'Loan - Hino Truck Unexpired Interest', -8_000, 'nonCurrentLiabilities.chattelMortgages'),
    ]
    const s = slot(
      2025,
      'primary',
      bs({ nonCurrentLiabilities: { chattelMortgages: 119_000 }, totals: { totalCurrentLiabilities: 27_000, totalNonCurrentLiabilities: 92_000 } }, lines),
      'fy25',
    )
    harmoniseMappings([s])
    const d = s.balanceSheet!.data
    expect(d.nonCurrentLiabilities.chattelMortgages).toBe(92_000)
    expect((d.currentLiabilities as Record<string, unknown>).other).toEqual({ [CURRENT_ASSET_FINANCE]: 27_000 })
  })
})

describe('director loans in the pass (item 1)', () => {
  it('moves a negative quarantined loan under liabilities to the receivable as a POSITIVE amount', () => {
    const slots = [
      slot(2025, 'primary', bs({ nonCurrentAssets: { directorRelatedLoansReceivable: 40_000 } }, [
        line('nonCurrentAssets', 'Loan 2020 (Quarantined)', 10_000, 'nonCurrentAssets.directorRelatedLoansReceivable'),
        line('nonCurrentAssets', 'Loan - 2023 (Quarantined)', 30_000, 'nonCurrentAssets.directorRelatedLoansReceivable'),
      ]), 'fy25'),
      slot(2023, 'primary', bs({ nonCurrentLiabilities: { loansAndFinance: -30_000 } }, [
        line('nonCurrentLiabilities', 'Loan - 2023 (Quarantined)', -30_000, 'nonCurrentLiabilities.loansAndFinance'),
      ]), 'fy23'),
    ]
    harmoniseMappings(slots)
    expect(slots[0].balanceSheet!.data.nonCurrentAssets.directorRelatedLoansReceivable).toBe(40_000)
    expect(slots[1].balanceSheet!.data.nonCurrentAssets.directorRelatedLoansReceivable).toBe(30_000)
    expect(slots[1].balanceSheet!.data.nonCurrentLiabilities.loansAndFinance).toBeUndefined()
  })

  it('rebuilds a category whose lines add up even when another section does not', () => {
    // Non-current assets add up (PPE 50,000 + four loans 140,000 = 190,000);
    // current liabilities do not (a line was missed). The model's receivable
    // figure (14,000) contradicts its own lines.
    const lines = [
      line('currentAssets', 'Trade Debtors', 10_000, 'currentAssets.accountsReceivable'),
      line('currentAssets', 'Total Current Assets', 10_000, 'totals.totalCurrentAssets', true),
      line('nonCurrentAssets', 'Plant & Equipment', 50_000, 'nonCurrentAssets.propertyPlantEquipment'),
      line('nonCurrentAssets', 'Loan 2020 (Quarantined)', 10_000, 'nonCurrentAssets.directorRelatedLoansReceivable'),
      line('nonCurrentAssets', 'Loan - 2023 (Quarantined)', 30_000, 'nonCurrentAssets.directorRelatedLoansReceivable'),
      line('nonCurrentAssets', 'Loan - 2024 (Quarantined)', 80_000, 'nonCurrentAssets.directorRelatedLoansReceivable'),
      line('nonCurrentAssets', 'Loan - 2025', 20_000, 'nonCurrentAssets.directorRelatedLoansReceivable'),
      line('nonCurrentAssets', 'Total Non-Current Assets', 190_000, 'totals.totalNonCurrentAssets', true),
      line('currentLiabilities', 'GST', 5_000, 'currentLiabilities.gstPayable'),
      line('currentLiabilities', 'Total Current Liabilities', 9_000, 'totals.totalCurrentLiabilities', true),
    ]
    const col: FileColumn = {
      index: 0,
      lines,
      incomeStatement: { income: {}, cogs: {}, expenses: {}, totals: {} } as ExtractedIncomeStatement,
      balanceSheet: bs(
        {
          currentAssets: { accountsReceivable: 10_000 },
          nonCurrentAssets: { propertyPlantEquipment: 50_000, directorRelatedLoansReceivable: 14_000 },
          currentLiabilities: { gstPayable: 9_000 },
          totals: { totalCurrentAssets: 10_000, totalNonCurrentAssets: 190_000, totalCurrentLiabilities: 9_000 },
        },
        [],
      ),
    }
    const { columnNotes } = correctFile([col], { isTrust: false }, null)
    expect(col.balanceSheet.nonCurrentAssets.directorRelatedLoansReceivable).toBe(140_000)
    expect(col.balanceSheet.nonCurrentAssets.propertyPlantEquipment).toBe(50_000)
    // The section that does not add up keeps the figure as read.
    expect(col.balanceSheet.currentLiabilities.gstPayable).toBe(9_000)
    const note = columnNotes[0].find((n) => n.kind === 'lines_incomplete')!
    expect(note.message).toContain('Current Liabilities: lines add to $5,000, printed total $9,000')
    expect(note.message).toContain('non current assets')
  })
})

describe('order independence (a)', () => {
  function build(): StoredStatementSlot[] {
    return [
      slot(2025, 'primary', bs({ currentLiabilities: { bankOverdraft: 4_000, other: { 'Accrued Charges': 700 } }, nonCurrentLiabilities: { chattelMortgages: 50_000 } } as never, [
        line('currentLiabilities', 'Business Account', 4_000, 'currentLiabilities.bankOverdraft'),
        line('currentLiabilities', 'Accrued Charges', 700, 'currentLiabilities.other.Accrued Charges'),
        line('nonCurrentLiabilities', 'Loan - VW', 50_000, 'nonCurrentLiabilities.chattelMortgages'),
      ]), 'fy25'),
      slot(2024, 'comparative', bs({ currentAssets: { bankAccounts: 9_000 }, currentLiabilities: { taxation: 650 } }, [
        line('currentAssets', 'Business Account', 9_000, 'currentAssets.bankAccounts'),
        line('currentLiabilities', 'Accrued Charges', 650, 'currentLiabilities.taxation'),
      ]), 'fy25'),
      slot(2024, 'primary', bs({ currentAssets: { bankAccounts: 9_000 }, currentLiabilities: { taxation: 650 }, nonCurrentLiabilities: { loansAndFinance: 60_000 } }, [
        line('currentAssets', 'Business Account', 9_000, 'currentAssets.bankAccounts'),
        line('currentLiabilities', 'Accrued Charges', 650, 'currentLiabilities.taxation'),
        line('nonCurrentLiabilities', 'Loan - VW', 60_000, 'nonCurrentLiabilities.loansAndFinance'),
      ]), 'fy24'),
      slot(2023, 'primary', bs({ currentAssets: { bankAccounts: 7_000 }, currentLiabilities: { other: { 'Accrued Charges': 600 } } } as never, [
        line('currentAssets', 'Business Account', 7_000, 'currentAssets.bankAccounts'),
        line('currentLiabilities', 'Accrued Charges', 600, 'currentLiabilities.other.Accrued Charges'),
      ]), 'fy23'),
    ]
  }

  const outcome = (slots: StoredStatementSlot[], checks: ReturnType<typeof harmoniseMappings>) => ({
    figures: Object.fromEntries([...slots].sort((a, b) => a.id.localeCompare(b.id)).map((s) => [s.id, figures(s)])),
    checks,
  })

  it('gives the same figures and notes whatever the order of files and lines', () => {
    const reference = build()
    const expected = outcome(reference, harmoniseMappings(reference))

    // Deterministic shuffles: every rotation of the files, lines reversed.
    for (let shift = 0; shift < 4; shift++) {
      const shuffled = build()
      for (const s of shuffled) s.balanceSheet!.data.lines!.reverse()
      const rotated = [...shuffled.slice(shift), ...shuffled.slice(0, shift)]
      expect(outcome(shuffled, harmoniseMappings(rotated))).toEqual(expected)
    }
  })
})

describe('the invariant (c)', () => {
  it('reverts a statement the pass would leave with a figure above its section total, and says so', () => {
    const own = slot(
      2025,
      'primary',
      bs(
        {
          currentLiabilities: { other: { 'Equipment Hire Purchase': 40_000 } },
          nonCurrentLiabilities: { chattelMortgages: 10_000 },
          totals: { totalCurrentLiabilities: 40_000, totalNonCurrentLiabilities: 10_000 },
        } as never,
        [
          line('currentLiabilities', 'Equipment Hire Purchase', 40_000, 'currentLiabilities.other.Equipment Hire Purchase'),
          line('nonCurrentLiabilities', 'Chattel Mortgage', 10_000, 'nonCurrentLiabilities.chattelMortgages'),
        ],
      ),
      'fy25',
    )
    // Two other files filed the same current-liability label under chattel mortgages.
    const others = [2024, 2023].map((year) =>
      slot(year, 'primary', bs(
        { nonCurrentLiabilities: { chattelMortgages: 45_000 }, totals: { totalNonCurrentLiabilities: 45_000 } },
        [line('currentLiabilities', 'Equipment Hire Purchase', 45_000, 'nonCurrentLiabilities.chattelMortgages')],
      ), `fy${year - 2000}`),
    )
    const checks = harmoniseMappings([own, ...others])

    const d = own.balanceSheet!.data
    expect(d.nonCurrentLiabilities.chattelMortgages).toBe(10_000)
    expect((d.currentLiabilities as Record<string, unknown>).other).toEqual({ 'Equipment Hire Purchase': 40_000 })
    const reverted = checks.find((c) => c.group === 'mapping_reverted')!
    expect(reverted).toMatchObject({ severity: 'warning', financialYear: 2025, statement: 'balance_sheet' })
    expect(reverted.message).toContain('chattel mortgages $50,000 is more than all its non current liabilities lines together ($10,000)')
    // No note claims a move that was undone.
    expect(checks.filter((c) => c.group === 'mapping_consistency')).toEqual([])
  })

  it('never leaves a negative director loan receivable silently', () => {
    const s = slot(2025, 'primary', bs({ nonCurrentAssets: { directorRelatedLoansReceivable: -5_000 } }, [
      line('nonCurrentAssets', 'Sundry Loan', -5_000, 'nonCurrentAssets.directorRelatedLoansReceivable'),
    ]), 'fy25')
    const checks = harmoniseMappings([s])
    expect(checks).toEqual([expect.objectContaining({ severity: 'warning', group: 'invariant', message: expect.stringContaining('director loans receivable is negative') })])
  })
})
