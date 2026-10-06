import { describe, it, expect, vi, afterEach } from 'vitest'
import { balanceSheetAtoTotal, creditorDebt, daysSinceLastPayment, icaPosition, type IcaRow } from '../creditorDebt'
import type { ExtractedBalanceSheet } from '@/lib/financials/types'

/** The creditor (ATO) debt and the payment gap. SYNTHETIC account rows. */

afterEach(() => vi.useRealTimers())

// An ATO integrated client account, newest first, as exported.
const ICA: IcaRow[] = [
  { rowIndex: 0, processedDate: '2026-04-20T00:00:00.000Z', balance: 211_061.47, lodgementType: 'GIC' },
  { rowIndex: 1, processedDate: '2026-04-09T00:00:00.000Z', balance: 209_848.34, lodgementType: 'Payment' },
  { rowIndex: 2, processedDate: '2026-04-09T00:00:00.000Z', balance: null, lodgementType: 'Payment' },
  { rowIndex: 3, processedDate: '2026-04-01T00:00:00.000Z', balance: 216_848.34, lodgementType: 'GIC' },
]

const bs = (cl: Record<string, number>): ExtractedBalanceSheet => ({
  currentAssets: {},
  nonCurrentAssets: {},
  currentLiabilities: cl,
  nonCurrentLiabilities: {},
  equity: {},
  totals: {},
})

describe('icaPosition', () => {
  it("takes the ATO's own running balance on the newest row, and the latest date as the statement date", () => {
    expect(icaPosition(ICA)).toEqual({ balance: 211_061.47, balanceDate: '2026-04-20', statementDate: '2026-04-20' })
  })

  it('handles no rows', () => {
    expect(icaPosition([])).toEqual({ balance: null, balanceDate: null, statementDate: null })
  })
})

describe('creditorDebt', () => {
  it('uses the integrated client account first, with its date', () => {
    const debt = creditorDebt({ icaRows: ICA, balanceSheet: bs({ atoLiability: 50_000, gstPayable: 9_000 }) })
    expect(debt).toMatchObject({ amount: 211_061.47, source: 'ica', asOf: '2026-04-20' })
    expect(debt.description).toBe('ATO integrated client account at 20 Apr 2026')
  })

  it('never adds the balance sheet on top: GST and PAYG are already in the account balance', () => {
    expect(creditorDebt({ icaRows: ICA, balanceSheet: bs({ gstPayable: 9_000 }) }).amount).toBe(211_061.47)
  })

  it('falls back to the balance sheet ATO-related total — a "GST account" with no ATO line included', () => {
    const debt = creditorDebt({
      icaRows: null,
      balanceSheet: bs({ gstPayable: 42_000, paygWithholdingPayable: 8_000, superannuationPayable: 5_000 }),
      balanceSheetDate: '2025-06-30',
      balanceSheetLabel: 'FY2025',
    })
    expect(debt).toMatchObject({ amount: 55_000, source: 'balance_sheet', asOf: '2025-06-30', missing: null })
    expect(debt.description).toContain('FY2025')
  })

  it('uses the amount staff entered over everything else', () => {
    expect(creditorDebt({ icaRows: ICA, staffAmount: 180_000 })).toMatchObject({ amount: 180_000, source: 'staff' })
  })

  it('treats a credit balance as no ATO debt', () => {
    expect(creditorDebt({ icaRows: [{ processedDate: '2026-01-01', balance: -1_500 }] }).amount).toBe(0)
  })

  it('names the missing input instead of "run financials extraction"', () => {
    const debt = creditorDebt({ icaRows: null, balanceSheet: bs({}) })
    expect(debt.amount).toBeNull()
    expect(debt.missing).toMatch(/ATO integrated client account CSV/)
    expect(debt.missing).not.toMatch(/financials extraction/)
  })

  it('reads the balance sheet total from the four ATO-related lines only', () => {
    expect(balanceSheetAtoTotal(bs({ atoLiability: 1, gstPayable: 2, paygWithholdingPayable: 3, superannuationPayable: 4, bankOverdraft: 100 }))).toBe(10)
    expect(balanceSheetAtoTotal(bs({ bankOverdraft: 100 }))).toBeNull()
  })
})

describe('daysSinceLastPayment', () => {
  it('measures to the statement date, not today', () => {
    // Last payment 9 Apr 2026, statement 20 Apr 2026: 11 days.
    expect(daysSinceLastPayment(ICA)).toBe(11)
  })

  it('gives the same answer whatever day it is run', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-01T00:00:00Z'))
    const first = daysSinceLastPayment(ICA)
    vi.setSystemTime(new Date('2027-01-01T00:00:00Z'))
    expect(daysSinceLastPayment(ICA)).toBe(first)
  })

  it('returns the no-payment sentinel when there are none', () => {
    expect(daysSinceLastPayment(ICA.filter((r) => r.lodgementType !== 'Payment'))).toBe(9999)
    expect(daysSinceLastPayment(null)).toBe(9999)
  })
})
