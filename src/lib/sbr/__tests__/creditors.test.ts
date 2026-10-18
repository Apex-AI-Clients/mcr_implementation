import { describe, it, expect } from 'vitest'
import {
  CREDITOR_LABEL_MAX,
  DEFAULT_CREDITOR_LABELS,
  creditorHints,
  creditorTotal,
  defaultCreditorRows,
  normaliseCreditorRows,
  readSavedCreditors,
} from '../creditors'
import type { ExtractedBalanceSheet, StatementLine, StoredStatementSlot } from '@/lib/financials/types'

/** Creditors in the SBR. Synthetic figures and labels only. */

const line = (section: StatementLine['section'], rawLabel: string, value: number | null, isTotal = false): StatementLine => ({
  section,
  rawLabel,
  value,
  canonicalKey: null,
  isTotal,
})

function slot(
  financialYear: number,
  sourceColumn: StoredStatementSlot['sourceColumn'],
  bs: Partial<ExtractedBalanceSheet> & { lines?: StatementLine[] },
  periodEndDate = `${financialYear}-06-30`,
): StoredStatementSlot {
  const data = {
    currentAssets: {},
    nonCurrentAssets: {},
    currentLiabilities: {},
    nonCurrentLiabilities: {},
    equity: {},
    totals: {},
    ...bs,
  } as ExtractedBalanceSheet
  return {
    id: `slot-${financialYear}-${sourceColumn}`,
    financialYear,
    periodEndDate,
    periodStartDate: null,
    periodLabel: null,
    sourceColumn,
    incomeStatement: null,
    balanceSheet: { data, documentId: 'doc-1', warnings: [] } as unknown as StoredStatementSlot['balanceSheet'],
    slotWarnings: [],
    legacy: false,
    extractionModel: null,
  }
}

describe('rows and total', () => {
  it('starts with six default labels and no amounts', () => {
    expect(defaultCreditorRows().map((r) => r.label)).toEqual([...DEFAULT_CREDITOR_LABELS])
    expect(defaultCreditorRows().every((r) => r.amount === null)).toBe(true)
  })

  it('adds the ATO debt and every row with an amount', () => {
    const rows = normaliseCreditorRows([{ label: 'Credit cards', amount: 12_500 }, { label: 'Overdraft', amount: 0 }, { label: 'Supplier', amount: 7_500 }])
    expect(creditorTotal(100_000, rows)).toBe(120_000)
    expect(creditorTotal(null, rows)).toBe(20_000)
    expect(creditorTotal(100_000, defaultCreditorRows())).toBe(100_000)
    expect(creditorTotal(null, defaultCreditorRows())).toBeNull()
  })

  it('cleans labels and amounts, and pads to six rows', () => {
    const rows = normaliseCreditorRows([{ label: `  ${'x'.repeat(80)}  `, amount: -5 }, { label: 'Fuel card', amount: Number.NaN }])
    expect(rows).toHaveLength(6)
    expect(rows[0].label).toHaveLength(CREDITOR_LABEL_MAX)
    expect(rows[0].amount).toBeNull()
    expect(rows[1]).toEqual({ label: 'Fuel card', amount: null })
    expect(rows[5].label).toBe('Other creditor 2')
  })

  it('reads a saved value defensively', () => {
    expect(readSavedCreditors(null)).toBeNull()
    expect(readSavedCreditors({ atoDebt: 50_000, atoDebtEdited: true, rows: [{ label: 'Cards', amount: 1_000 }] })).toEqual({
      atoDebt: 50_000,
      atoDebtEdited: true,
      rows: normaliseCreditorRows([{ label: 'Cards', amount: 1_000 }]),
    })
    expect(readSavedCreditors({ rows: 'nope' })?.rows).toEqual(defaultCreditorRows())
  })
})

describe('balance-sheet hints', () => {
  const lines = [
    line('currentLiabilities', 'Credit Card - Business Visa', 4_200),
    line('currentLiabilities', 'Trade Creditors', 18_300),
    line('currentLiabilities', 'GST Payable', 9_000),
    line('nonCurrentLiabilities', 'Bank Loan - Westpac', 60_000),
    line('nonCurrentLiabilities', 'Loan - Director', 90_000),
    line('currentLiabilities', 'Total Current Liabilities', 31_500, true),
  ]

  it('reads the latest year when there is no current period', () => {
    const hints = creditorHints([
      slot(2025, 'primary', { lines, currentLiabilities: { bankOverdraft: 2_500 }, nonCurrentLiabilities: { chattelMortgages: 25_000 } }),
      slot(2024, 'primary', { lines: [line('currentLiabilities', 'Trade Creditors', 1)] }),
    ])
    // Cash loans: the bank loan plus the chattel finance, with the caution.
    expect(hints.map((h) => h?.amount ?? null)).toEqual([4_200, 85_000, 2_500, 18_300, null, null])
    expect(hints[0]?.source).toBe('FY2025 balance sheet')
    expect(hints[1]?.caution).toBe(
      'Includes $25,000 of chattel, hire-purchase, vehicle or equipment finance. Usually secured — check before including',
    )
    expect(hints[0]?.caution).toBeNull()
  })

  it('has no default row for secured finance', () => {
    expect(DEFAULT_CREDITOR_LABELS).toEqual(['Credit cards', 'Cash loans', 'Bank overdraft', 'Trade suppliers', 'Other creditor 1', 'Other creditor 2'])
    expect(DEFAULT_CREDITOR_LABELS.some((l) => /finance|equipment|vehicle/i.test(l))).toBe(false)
  })

  it('cautions on Cash loans when the only loan is finance', () => {
    const hints = creditorHints([slot(2025, 'primary', { lines: [line('nonCurrentLiabilities', 'Hire Purchase - Excavator', 40_000)] })])
    expect(hints[1]?.amount).toBe(40_000)
    expect(hints[1]?.caution).toMatch(/Usually secured — check before including$/)
  })

  it('has no caution on Cash loans without finance', () => {
    const hints = creditorHints([slot(2025, 'primary', { lines: [line('currentLiabilities', 'Cash Loan - Lender', 9_000)] })])
    expect(hints[1]).toEqual({ amount: 9_000, source: 'FY2025 balance sheet', caution: null })
  })

  it('prefers the current period, where a $0 overdraft means it was repaid', () => {
    const hints = creditorHints([
      slot(2026, 'primary', { lines, currentLiabilities: { bankOverdraft: 2_500 } }),
      slot(2027, 'current_period', { currentLiabilities: { bankOverdraft: 0 } }, '2026-09-30'),
    ])
    expect(hints[2]).toEqual({ amount: 0, source: 'at 30 Sep 2026 (current period)', caution: null })
    expect(hints[3]).toBeNull()
  })

  it('never counts ATO, super or director loans, or totals, as a creditor', () => {
    const hints = creditorHints([
      slot(2025, 'primary', {
        lines: [
          line('currentLiabilities', 'ATO Integrated Account creditors', 30_000),
          line('currentLiabilities', 'Superannuation creditors', 3_000),
          line('nonCurrentLiabilities', 'Loan - related party (bank funded)', 50_000),
          line('currentLiabilities', 'Total creditors', 33_000, true),
        ],
      }),
    ])
    expect(hints.every((h) => h === null)).toBe(true)
  })

  it('has no hints without a balance sheet', () => {
    expect(creditorHints([]).every((h) => h === null)).toBe(true)
  })
})
