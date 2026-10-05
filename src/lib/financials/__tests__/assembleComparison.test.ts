import { describe, it, expect, vi, beforeEach } from 'vitest'
import { restatementChecks } from '../checks'
import { harmoniseMappings } from '../mappingConsistency'
import type {
  ExtractedBalanceSheet,
  ExtractedIncomeStatement,
  FinancialStatementSourceColumn,
  StatementLine,
  StoredStatementSlot,
} from '../types'

/**
 * Corrections applied when the comparison is assembled, across a client's
 * files. SYNTHETIC figures, laid out like the separate-file trust client:
 * one P&L PDF and one Balance Sheet PDF per year.
 */

const mockCreate = vi.fn()
vi.mock('../../ai/openrouterClient', () => ({
  getOpenRouterClient: () => ({ chat: { completions: { create: mockCreate } } }),
}))
const { assembleComparison } = await import('../assembleComparison')
const { generateFinancialsComparisonSummary } = await import('../../ai/financialsComparisonSummary')

const line = (
  section: StatementLine['section'],
  rawLabel: string,
  value: number | null,
  canonicalKey: string | null,
  isTotal = false,
): StatementLine => ({ section, rawLabel, value, canonicalKey, isTotal })

function half<T>(data: T, doc: string) {
  return { data, documentId: doc, sourceFilename: `${doc}.pdf`, extractedAt: null, warnings: [] }
}

function slot(
  year: number,
  column: FinancialStatementSourceColumn,
  parts: { is?: [ExtractedIncomeStatement, string]; bs?: [ExtractedBalanceSheet, string] },
): StoredStatementSlot {
  return {
    id: `${year}-${column}`,
    financialYear: year,
    periodEndDate: `${year}-06-30`,
    periodStartDate: null,
    periodLabel: null,
    sourceColumn: column,
    incomeStatement: parts.is ? half(parts.is[0], parts.is[1]) : null,
    balanceSheet: parts.bs ? half(parts.bs[0], parts.bs[1]) : null,
    slotWarnings: [],
    legacy: false,
    extractionModel: null,
  }
}

/** A trust balance sheet with shop fittings and a bond, the bond mapped as given. */
function trustBs(bond: number, bondKey: string, fittings = 40_000): ExtractedBalanceSheet {
  const ppe = bondKey === 'nonCurrentAssets.propertyPlantEquipment' ? fittings + bond : fittings
  return {
    currentAssets: { bankAccounts: 10_000 },
    nonCurrentAssets: {
      propertyPlantEquipment: ppe,
      ...(bondKey === 'nonCurrentAssets.other.Deposits' ? { other: { Deposits: bond } } : {}),
    } as ExtractedBalanceSheet['nonCurrentAssets'],
    currentLiabilities: {},
    nonCurrentLiabilities: {},
    equity: {},
    totals: { totalAssets: 10_000 + fittings + bond, totalLiabilities: 30_000, netAssets: 20_000 + fittings + bond - 40_000 },
    lines: [
      line('currentAssets', 'Cash at Bank', 10_000, 'currentAssets.bankAccounts'),
      line('nonCurrentAssets', 'Shop Fittings', fittings, 'nonCurrentAssets.propertyPlantEquipment'),
      line('nonCurrentAssets', 'Bond', bond, bondKey),
    ],
  }
}

/** A trust P&L with the prior-year loss lines, the model having read the after-loss figure as NPAT. */
function trustPnl(year: number, sales: number): ExtractedIncomeStatement {
  const pbt = sales - 120_000 - 50_000
  return {
    income: { sales },
    cogs: { purchases: 120_000 },
    expenses: { rent: 50_000 },
    totals: {
      totalIncome: sales,
      totalCogs: 120_000,
      totalExpenses: 50_000,
      profitBeforeTax: pbt,
      netProfitAfterTax: pbt - 12_000, // "NET TRADING PROFIT/(LOSS) AFTER DEDUCTING LOSS"
    },
    lines: [
      line('income', 'Sales', sales, 'income.sales'),
      line('cogs', 'Purchases', 120_000, 'cogs.purchases'),
      line('expenses', 'Rent', 50_000, 'expenses.rent'),
      line('incomeTotals', 'Net Profit', pbt, 'totals.profitBeforeTax', true),
      line('appropriation', 'Less Prior Year Loss', 12_000, null),
      line('incomeTotals', 'NET TRADING PROFIT/(LOSS) AFTER DEDUCTING LOSS', pbt - 12_000, 'totals.netProfitAfterTax', true),
    ],
  }
}

const trustRecords = [
  {
    documentId: 'pnl-2025',
    filename: '2024-2025_PROFIT_AND_LOSS.pdf',
    kind: 'pnl_only' as const,
    headingEntity: { name: 'SAMPLE HOLDINGS PTY LTD ATF SAMPLE FAMILY TRUST', abns: [] },
    warnings: [],
  },
]

beforeEach(() => mockCreate.mockReset())

describe('mapping consistency across files', () => {
  it('maps the bond and the shop fittings the same way in both files', () => {
    // FY2024's file had the bond read as fittings (PPE); FY2025's as deposits.
    const slots = [
      slot(2024, 'primary', { bs: [trustBs(5_000, 'nonCurrentAssets.propertyPlantEquipment'), 'bs-2024'] }),
      slot(2025, 'primary', { bs: [trustBs(5_000, 'nonCurrentAssets.other.Deposits'), 'bs-2025'] }),
    ]
    const checks = harmoniseMappings(slots)

    for (const s of slots) {
      expect(s.balanceSheet!.data.nonCurrentAssets.propertyPlantEquipment).toBe(40_000)
      expect((s.balanceSheet!.data.nonCurrentAssets as Record<string, unknown>).other).toEqual({ Deposits: 5_000 })
    }
    expect(checks).toEqual([
      expect.objectContaining({
        kind: 'mapping_consistency',
        severity: 'info',
        message: expect.stringMatching(/"Bond" was read as property plant equipment in bs-2024\.pdf.*label dictionary/),
        documentIds: ['bs-2024'],
      }),
    ])
  })

  it('uses the key most files used for a label the dictionary does not know', () => {
    const debtors = (key: string): ExtractedBalanceSheet => ({
      currentAssets: key === 'currentAssets.accountsReceivable' ? { accountsReceivable: 3_000 } : ({ other: { 'Trade Debtors': 3_000 } } as never),
      nonCurrentAssets: {},
      currentLiabilities: {},
      nonCurrentLiabilities: {},
      equity: {},
      totals: { totalAssets: 3_000 },
      lines: [line('currentAssets', 'Trade Debtors', 3_000, key)],
    })
    const slots = [
      slot(2023, 'primary', { bs: [debtors('currentAssets.accountsReceivable'), 'a'] }),
      slot(2024, 'primary', { bs: [debtors('currentAssets.accountsReceivable'), 'b'] }),
      slot(2025, 'primary', { bs: [debtors('currentAssets.other'), 'c'] }),
    ]
    const [check] = harmoniseMappings(slots)
    expect(slots[2].balanceSheet!.data.currentAssets).toEqual({ accountsReceivable: 3_000 })
    expect(check.message).toMatch(/what most files used/)
  })
})

describe('restatement by raw label', () => {
  it('raises nothing when only the mapping differs between the two files', () => {
    const slots = [
      slot(2024, 'primary', { bs: [trustBs(5_000, 'nonCurrentAssets.propertyPlantEquipment'), 'bs-2024'] }),
      slot(2024, 'comparative', { bs: [trustBs(5_000, 'nonCurrentAssets.other.Deposits'), 'bs-2025'] }),
    ]
    expect(restatementChecks(slots)).toEqual([])
  })

  it('raises the printed line whose value moved, by its label', () => {
    const slots = [
      slot(2024, 'primary', { bs: [trustBs(5_000, 'nonCurrentAssets.other.Deposits'), 'bs-2024'] }),
      slot(2024, 'comparative', { bs: [trustBs(5_000, 'nonCurrentAssets.other.Deposits', 46_000), 'bs-2025'] }),
    ]
    const [check] = restatementChecks(slots)
    expect(check.message).toContain('Shop Fittings $40,000 → $46,000')
  })
})

describe('assembleComparison (trust, separate files)', () => {
  function trustSlots() {
    return [
      slot(2024, 'primary', { is: [trustPnl(2024, 220_000), 'pnl-2024'], bs: [trustBs(5_000, 'nonCurrentAssets.other.Deposits'), 'bs-2024'] }),
      slot(2025, 'primary', { is: [trustPnl(2025, 250_000), 'pnl-2025'], bs: [trustBs(5_000, 'nonCurrentAssets.other.Deposits'), 'bs-2025'] }),
    ]
  }

  it('corrects net profit after tax to profit before tax before anything is computed', () => {
    const slots = trustSlots()
    const result = assembleComparison({ slots, records: trustRecords, company: null })
    if (!result.ok) throw new Error('expected a comparison')
    for (const s of slots) {
      const t = s.incomeStatement!.data.totals
      expect(t.netProfitAfterTax).toBe(t.profitBeforeTax)
    }
    expect(result.comparison.checks?.some((c) => /Net profit after tax was read as/.test(c.message))).toBe(true)
  })

  it('never shows the stored "combined PDF expected" note for a P&L-only file', () => {
    const slots = trustSlots()
    slots[1].incomeStatement!.warnings = [
      { kind: 'incomplete_current_period', message: 'P&L present but no Balance Sheet detected — combined PDF expected' },
    ]
    const result = assembleComparison({ slots, records: trustRecords, company: null })
    if (!result.ok) throw new Error('expected a comparison')
    expect(result.comparison.checks?.some((c) => /combined PDF expected/.test(c.message))).toBe(false)
  })

  it('builds the AI summary only from the corrected figures', async () => {
    mockCreate.mockResolvedValue({ choices: [{ message: { content: 'Summary.' } }], model: 'test' })
    const slots = trustSlots()
    const bogus = slots.map((s) => s.incomeStatement!.data.totals.netProfitAfterTax as number)

    const result = assembleComparison({ slots, records: trustRecords, company: null })
    if (!result.ok) throw new Error('expected a comparison')
    await generateFinancialsComparisonSummary({ comparison: result.comparison })

    const prompt = mockCreate.mock.calls[0][0].messages[0].content as string
    const formatted = (n: number) => Math.round(n).toLocaleString('en-AU')
    // The after-loss figures the model read as net profit never reach the summary…
    for (const value of bogus) expect(prompt).not.toContain(`Net profit/(loss) $${formatted(value)}`)
    // …the operating profit does.
    expect(prompt).toContain(`Net profit/(loss) $${formatted(250_000 - 170_000)}`)
  })
})
