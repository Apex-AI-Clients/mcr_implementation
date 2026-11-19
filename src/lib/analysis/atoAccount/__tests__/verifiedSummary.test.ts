import { describe, expect, it } from 'vitest'
import { verifiedAccountSummary } from '../verifiedSummary'

/** The income tax and super guarantee summaries on the ICA engine (Stage 3). Synthetic rows, newest first. */

const row = (i: number, processed: string, effective: string, description: string, debit: number | null, credit: number | null, balance: number | null) => ({
  rowIndex: i,
  processedDate: processed,
  effectiveDate: effective,
  description,
  debit,
  credit,
  balance,
})

const INCOME_TAX = [
  row(0, '2026-10-01', '2026-10-01', 'Payment received', null, 1000, 20250),
  row(1, '2026-07-01', '2026-07-01', 'General interest charge', 150, null, 21250),
  row(2, '2026-04-16', '2026-05-15', 'Tax return Companies - Income Tax for the period from 01 Jul 24 to 30 Jun 25', 21100, null, 21100),
]

const stored = (rows: unknown, kind = 'income_tax', status: string | null = 'verified') => ({ kind, rows, label: 'Income tax 001', ica_status: status, ica_forced: {} })

describe('verifiedAccountSummary', () => {
  it('builds the income tax summary from the rows the ATO balance proved', () => {
    const v = verifiedAccountSummary(stored(INCOME_TAX))
    expect(v?.kind).toBe('income_tax')
    if (v?.kind !== 'income_tax') return
    expect(v.summary.assessedTotal).toBe(21100)
    expect(v.summary.gic).toEqual({ charged: 150, remitted: 0, net: 150 })
    expect(v.summary.payments).toEqual({ count: 1, total: 1000, first: '2026-10-01', last: '2026-10-01' })
    // The verified balance, newest charges first: interest 150, then 20,100 of the assessment.
    expect(v.summary.assessments[0]).toMatchObject({ amount: 21100, unpaid: 20100, assessedOn: '2026-04-16', paymentDue: '2026-05-15' })
  })

  it('gives nothing for a file not verified, or whose rows no longer add up to its balance', () => {
    expect(verifiedAccountSummary(stored(INCOME_TAX, 'income_tax', 'unverified'))).toBeNull()
    expect(verifiedAccountSummary(stored(INCOME_TAX, 'income_tax', null))).toBeNull()
    expect(verifiedAccountSummary(stored(INCOME_TAX.map((r) => (r.rowIndex === 0 ? { ...r, balance: 20000 } : r))))).toBeNull()
  })

  it('leaves activity statements to the lodgement analysis', () => {
    expect(verifiedAccountSummary(stored(INCOME_TAX, 'activity_statement'))).toBeNull()
  })

  it("builds a super guarantee quarter from its event row and the amounts printed above it", () => {
    const period = 'for the period from 01 Jan 26 to 31 Mar 26'
    const rows = [
      row(0, '2026-06-01', '2026-06-01', `SGC Statement (Liability) - SG Shortfall ${period}`, 1000, null, 1310),
      row(1, '2026-06-01', '2026-06-01', `SGC Statement (Liability) - SG Nominal Interest ${period}`, 100, null, 310),
      row(2, '2026-06-01', '2026-06-01', `SGC Statement (Liability) - SG Administration Fee ${period}`, 200, null, 210),
      row(3, '2026-06-01', '2026-06-01', `Default SGC Statement (Liability) - Superannuation Guarantee (Quarterly) ${period}`, 0, null, 10),
      // An earlier day, so the export's order is plain.
      row(4, '2026-03-01', '2026-03-01', 'General interest charge', 10, null, 10),
    ]
    const v = verifiedAccountSummary(stored(rows, 'super_guarantee'))
    expect(v?.kind).toBe('super_guarantee')
    if (v?.kind !== 'super_guarantee') return
    expect(v.summary.quarters).toHaveLength(1)
    expect(v.summary.quarters[0]).toMatchObject({ shortfall: 1000, nominalInterest: 100, adminFee: 200, total: 1300 })
    expect(v.summary.quarters[0].headline?.kind).toBe('ato_default')
    expect(v.summary.unattributed).toBe(0)
    expect(v.summary.gic.charged).toBe(10)
  })
})
