import { describe, it, expect, vi, afterEach } from 'vitest'
import { balanceSheetAtoTotal, creditorDebt, daysSinceLastPayment, icaPosition, type IcaRow } from '../creditorDebt'
import type { ExtractedBalanceSheet } from '@/lib/financials/types'

/** The creditor (ATO) debt and the payment gap. SYNTHETIC account rows. */

afterEach(() => vi.useRealTimers())

// An ATO integrated client account, newest first, as exported.
const ICA: IcaRow[] = [
  { rowIndex: 0, processedDate: '2026-04-20T00:00:00.000Z', balance: 120_500.25, lodgementType: 'GIC' },
  { rowIndex: 1, processedDate: '2026-04-09T00:00:00.000Z', balance: 119_300.1, lodgementType: 'Payment' },
  { rowIndex: 2, processedDate: '2026-04-09T00:00:00.000Z', balance: null, lodgementType: 'Payment' },
  { rowIndex: 3, processedDate: '2026-04-01T00:00:00.000Z', balance: 125_000, lodgementType: 'GIC' },
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
    expect(icaPosition(ICA)).toEqual({ balance: 120_500.25, balanceDate: '2026-04-20', statementDate: '2026-04-20' })
  })

  it('handles no rows', () => {
    expect(icaPosition([])).toEqual({ balance: null, balanceDate: null, statementDate: null })
  })
})

describe('creditorDebt', () => {
  it('uses the ATO account statement first, as at its statement date', () => {
    const debt = creditorDebt({ icaRows: ICA, balanceSheet: bs({ atoLiability: 50_000, gstPayable: 9_000 }) })
    expect(debt).toMatchObject({ amount: 120_500.25, source: 'ica', asOf: '2026-04-20' })
    expect(debt.description).toBe('ATO account statement, 20 Apr 2026')
  })

  it('dates the balance by the statement (the newest row), even when that row prints no balance', () => {
    const rows: IcaRow[] = [{ rowIndex: 0, processedDate: '2026-09-26T00:00:00.000Z', balance: null }, ...ICA]
    expect(creditorDebt({ icaRows: rows })).toMatchObject({ asOf: '2026-09-26', description: 'ATO account statement, 26 Sep 2026' })
  })

  it('never adds the balance sheet on top: GST and PAYG are already in the account balance', () => {
    expect(creditorDebt({ icaRows: ICA, balanceSheet: bs({ gstPayable: 9_000 }) }).amount).toBe(120_500.25)
  })

  it('falls back to the balance sheet ATO liability, GST and PAYG — never super, which is owed to super funds', () => {
    const debt = creditorDebt({
      icaRows: null,
      balanceSheet: bs({ gstPayable: 42_000, paygWithholdingPayable: 8_000, superannuationPayable: 5_000 }),
      balanceSheetDate: '2025-06-30',
      balanceSheetLabel: 'FY2025',
    })
    expect(debt).toMatchObject({ amount: 50_000, source: 'balance_sheet', asOf: '2025-06-30', missing: null })
    expect(debt.description).toBe('Balance sheet (FY2025), as at 30 Jun 2025: ATO, GST and PAYG')
  })

  it('asks for the lodgement analysis to be re-run when its rows carry no balance', () => {
    const debt = creditorDebt({
      icaRows: ICA.map((r) => ({ ...r, balance: null })),
      balanceSheet: bs({ gstPayable: 42_000 }),
    })
    expect(debt.source).toBe('balance_sheet')
    expect(debt.description).toMatch(/Re-run the lodgement analysis/)
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

  it('reads the balance sheet total from the ATO liability, GST and PAYG lines only', () => {
    expect(balanceSheetAtoTotal(bs({ atoLiability: 1, gstPayable: 2, paygWithholdingPayable: 3, superannuationPayable: 4, bankOverdraft: 100 }))).toBe(6)
    expect(balanceSheetAtoTotal(bs({ superannuationPayable: 4 }))).toBeNull()
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
