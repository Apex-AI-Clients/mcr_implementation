import { describe, it, expect, vi, afterEach } from 'vitest'
import { creditorDebt, daysSinceLastPayment, icaPosition, lastPaymentDate, type IcaRow } from '../creditorDebt'

/** The creditor (ATO) debt and the payment gap. SYNTHETIC account rows. */

afterEach(() => vi.useRealTimers())

// An ATO integrated client account, newest first, as exported.
const ICA: IcaRow[] = [
  { rowIndex: 0, processedDate: '2026-04-20T00:00:00.000Z', balance: 120_500.25, lodgementType: 'GIC' },
  { rowIndex: 1, processedDate: '2026-04-09T00:00:00.000Z', balance: 119_300.1, lodgementType: 'Payment' },
  { rowIndex: 2, processedDate: '2026-04-09T00:00:00.000Z', balance: null, lodgementType: 'Payment' },
  { rowIndex: 3, processedDate: '2026-04-01T00:00:00.000Z', balance: 125_000, lodgementType: 'GIC' },
]

const ato = (amount: number, lines = ['GST Payable']) => ({ amount, lines })

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
    const debt = creditorDebt({ icaRows: ICA, mappedAto: ato(59_000) })
    expect(debt).toMatchObject({ amount: 120_500.25, source: 'ica', asOf: '2026-04-20' })
    expect(debt.description).toBe('ATO account statement, 20 Apr 2026')
  })

  it('dates the balance by the statement (the newest row), even when that row prints no balance', () => {
    const rows: IcaRow[] = [{ rowIndex: 0, processedDate: '2026-09-26T00:00:00.000Z', balance: null }, ...ICA]
    expect(creditorDebt({ icaRows: rows })).toMatchObject({ asOf: '2026-09-26', description: 'ATO account statement, 26 Sep 2026' })
  })

  it('never adds the balance sheet on top: GST and PAYG are already in the account balance', () => {
    expect(creditorDebt({ icaRows: ICA, mappedAto: ato(9_000) }).amount).toBe(120_500.25)
  })

  it('falls back to the ATO-related balance sheet lines staff confirmed, naming them', () => {
    const debt = creditorDebt({
      icaRows: null,
      mappedAto: ato(50_000, ['GST Payable', 'PAYG Withholding Payable']),
      balanceSheetDate: '2025-06-30',
      balanceSheetLabel: 'FY2025',
    })
    expect(debt).toMatchObject({ amount: 50_000, source: 'balance_sheet', asOf: '2025-06-30', missing: null })
    expect(debt.description).toBe('Balance sheet (FY2025), as at 30 Jun 2025: “GST Payable” + “PAYG Withholding Payable”')
  })

  it('asks for the lodgement analysis to be re-run when its rows carry no balance', () => {
    const debt = creditorDebt({
      icaRows: ICA.map((r) => ({ ...r, balance: null })),
      mappedAto: ato(42_000),
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
    const debt = creditorDebt({ icaRows: null, mappedAto: null })
    expect(debt.amount).toBeNull()
    expect(debt.missing).toMatch(/ATO integrated client account CSV/)
    expect(debt.missing).not.toMatch(/financials extraction/)
  })
})

describe('daysSinceLastPayment', () => {
  it('measures from the last payment to the day given (the prediction gives today), as before 6 Oct 2026', () => {
    // Last payment 9 Apr 2026; asked on 25 Nov 2026: 230 days. The account's newest row (20 Apr) does not matter.
    expect(daysSinceLastPayment(ICA, '2026-11-25')).toBe(230)
    expect(daysSinceLastPayment(ICA, '2026-04-20')).toBe(11)
  })

  it('a payment on the newest row of the account is not 0 when asked later (the 25 Nov 2026 report: last payment 19 Nov)', () => {
    const rows: IcaRow[] = [{ rowIndex: 0, processedDate: '2026-11-19T00:00:00.000Z', rawProcessed: '19 Nov 2026', balance: 1000, lodgementType: 'Payment' }]
    expect(daysSinceLastPayment(rows, '2026-11-25')).toBe(6)
  })

  it('counts only payment rows: never an allocation line nor a credit that is not a payment', () => {
    const rows: IcaRow[] = [
      { rowIndex: 0, processedDate: '2026-10-01T00:00:00.000Z', balance: null, lodgementType: 'PaymentAllocation' },
      { rowIndex: 1, processedDate: '2026-10-02T00:00:00.000Z', balance: 500, lodgementType: 'CreditTransfer' },
      { rowIndex: 2, processedDate: '2026-09-01T00:00:00.000Z', balance: 900, lodgementType: 'Payment' },
    ]
    expect(daysSinceLastPayment(rows, '2026-09-11')).toBe(10)
  })

  it('returns the no-payment sentinel when there are none, and never less than 0', () => {
    expect(daysSinceLastPayment(ICA.filter((r) => r.lodgementType !== 'Payment'), '2026-11-25')).toBe(9999)
    expect(daysSinceLastPayment(null, '2026-11-25')).toBe(9999)
    expect(daysSinceLastPayment(ICA, '2026-01-01')).toBe(0)
  })
})

describe('dates from rows stored in another time zone', () => {
  it('takes the calendar day printed, not one shifted by where the row was stored', () => {
    // Stored by an analysis run ahead of UTC: local midnight is the previous day in UTC.
    const rows = [
      { rowIndex: 0, processedDate: '2026-08-31T18:30:00.000Z', rawProcessed: '01 Sep 2026', balance: 107_765.19, lodgementType: 'GIC' },
      { rowIndex: 1, processedDate: '2026-02-03T18:30:00.000Z', rawProcessed: '04 Feb 2026', balance: 90_000, lodgementType: 'Payment' },
    ]
    expect(icaPosition(rows)).toMatchObject({ balance: 107_765.19, balanceDate: '2026-09-01', statementDate: '2026-09-01' })
    expect(daysSinceLastPayment(rows, '2026-09-01')).toBe(209)
  })

  it('reads a date a spreadsheet re-saved as "20-Oct-26" as 20 October, not the stored day before (28 Nov 2026 report)', () => {
    const rows: IcaRow[] = [
      { rowIndex: 0, processedDate: '2026-10-19T18:30:00.000Z', rawProcessed: '20-Oct-26', balance: 50_000, lodgementType: 'Payment' },
      { rowIndex: 1, processedDate: '2026-10-12T18:30:00.000Z', rawProcessed: '13-Oct-26', balance: 52_400, lodgementType: 'Payment' },
    ]
    expect(lastPaymentDate(rows)).toBe('2026-10-20')
    expect(daysSinceLastPayment(rows, '2026-11-28')).toBe(39)
    expect(icaPosition(rows)).toMatchObject({ statementDate: '2026-10-20' })
    // Day-first slashes too.
    expect(lastPaymentDate([{ rowIndex: 0, processedDate: '2026-10-19T18:30:00.000Z', rawProcessed: '20/10/2026', lodgementType: 'Payment' }])).toBe('2026-10-20')
  })
})
