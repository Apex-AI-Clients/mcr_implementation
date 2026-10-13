import { describe, expect, it } from 'vitest'
import { computeLateLodgement } from '../computeLateLodgement'
import { parseActivityStatementCsv } from '../parseActivityStatement'
import { reconciliationGap } from '../debtReconciliation'

/**
 * Breakdown rows: a total listed with the rows that only break it down is one
 * amount (paymentAllocations.ts). Synthetic accounts only. The ATO lists
 * newest first; balances are the running balance after each printed row.
 */

const HEADER = '"Activity statement 001"\n"SAMPLE TRADING PTY LTD"\nProcessed date,Effective date,Description,Debit (DR),Credit (CR),Balance\n'
const row = (p: string, e: string, d: string, dr = '', cr = '', bal = '') => `"${p}","${e}","'${d}","${dr}","${cr}","${bal}"`
const analyse = (...rows: string[]) => computeLateLodgement(parseActivityStatementCsv(HEADER + rows.join('\n') + '\n'))

/** An account that opens with a $30,000 lodgement, so payments have something to reduce. */
const OPENING = row('28 Jul 2023', '28 Jul 2023', 'Original Activity Statement for the period ending 30 Jun 23', '$30,000.00', '', '$30,000.00 DR')

describe('payments', () => {
  it('counts a split payment once: the total row, not its allocation rows', () => {
    const r = analyse(
      row('19 Sep 2023', '18 Sep 2023', 'Payment received', '', '$10,000.00', '$20,000.00 DR'),
      row('19 Sep 2023', '18 Sep 2023', 'Payment received', '', '$6,000.00'),
      row('19 Sep 2023', '18 Sep 2023', 'Payment received', '', '$4,000.00'),
      OPENING,
    )
    expect(r.debtBreakdown.paymentsCount).toBe(1)
    expect(r.debtBreakdown.paymentsReceived).toBe(10_000)
    expect(r.rows.filter((x) => x.lodgementType === 'PaymentAllocation')).toHaveLength(2)
    expect(r.debtBreakdown.firstPaymentDate).toBe('2023-09-18') // effective date
    expect(reconciliationGap(r.debtBreakdown)).toBeNull()
  })

  it('counts a single unsplit payment', () => {
    const r = analyse(row('19 Sep 2023', '18 Sep 2023', 'Payment received', '', '$2,500.00', '$27,500.00 DR'), OPENING)
    expect(r.debtBreakdown.paymentsCount).toBe(1)
    expect(r.debtBreakdown.paymentsReceived).toBe(2_500)
  })

  it('never merges two genuine payments on the same day', () => {
    // Both printed with a balance…
    const both = analyse(
      row('19 Sep 2023', '18 Sep 2023', 'Payment received', '', '$300.00', '$29,200.00 DR'),
      row('19 Sep 2023', '18 Sep 2023', 'Payment received', '', '$500.00', '$29,500.00 DR'),
      OPENING,
    )
    expect(both.debtBreakdown.paymentsCount).toBe(2)
    expect(both.debtBreakdown.paymentsReceived).toBe(800)
    // …or the second without one, but not adding up to the first.
    const second = analyse(
      row('19 Sep 2023', '18 Sep 2023', 'Payment received', '', '$500.00', '$29,200.00 DR'),
      row('19 Sep 2023', '18 Sep 2023', 'Payment received', '', '$300.00'),
      OPENING,
    )
    expect(second.debtBreakdown.paymentsCount).toBe(2)
    expect(second.debtBreakdown.paymentsReceived).toBe(800)
  })

  it('does not treat rows on other dates as a breakdown', () => {
    const r = analyse(
      row('19 Sep 2023', '18 Sep 2023', 'Payment received', '', '$1,000.00', '$28,000.00 DR'),
      row('12 Sep 2023', '11 Sep 2023', 'Payment received', '', '$1,000.00'),
      OPENING,
    )
    expect(r.debtBreakdown.paymentsCount).toBe(2)
  })
})

describe('refunds paid to the company', () => {
  it('adds a refund to the balance, counting a "Refund" total once, not its EFT rows', () => {
    const r = analyse(
      row('09 Oct 2023', '14 Oct 2023', 'Refund', '$4,020.00', '', '$34,020.00 DR'),
      row('09 Oct 2023', '14 Oct 2023', ' EFT refund for GST for the period from 01 Jul 23 to 30 Sep 23', '$268.00'),
      row('09 Oct 2023', '14 Oct 2023', ' EFT refund for PAYG Withholding for the period from 01 Jul 23 to 30 Sep 23', '$3,752.00'),
      OPENING,
    )
    expect(r.debtBreakdown.refundsPaid).toBe(4_020)
    expect(r.rows.filter((x) => x.lodgementType === 'RefundDetail')).toHaveLength(2)
    expect(r.debtBreakdown.currentBalance).toBe(34_020)
    expect(reconciliationGap(r.debtBreakdown)).toBeNull()
  })

  it('counts a standalone EFT refund (printed with its own balance)', () => {
    const r = analyse(
      row('04 Oct 2023', '07 Oct 2023', ' EFT refund for PAYG Withholding for the period from 01 Jul 23 to 30 Sep 23', '$5,164.00', '', '$35,164.00 DR'),
      OPENING,
    )
    expect(r.debtBreakdown.refundsPaid).toBe(5_164)
    expect(reconciliationGap(r.debtBreakdown)).toBeNull()
  })
})

describe('interest', () => {
  it('counts a "General interest charge" remission total once, not the remissions listed under it', () => {
    const r = analyse(
      row('15 Nov 2023', '15 Nov 2023', 'General interest charge', '', '$300.00', '$29,700.00 DR'),
      row('15 Nov 2023', '15 Nov 2023', 'Remission of general interest charge', '', '$100.00'),
      row('15 Nov 2023', '15 Nov 2023', 'Remission of general interest charge', '', '$200.00'),
      OPENING,
    )
    expect(r.debtBreakdown.interestCredits).toBe(300)
    expect(r.rows.filter((x) => x.lodgementType === 'GICDetail')).toHaveLength(2)
    expect(reconciliationGap(r.debtBreakdown)).toBeNull()
  })
})

describe('opening balance', () => {
  it('carries what was owed before the first row, so the composition still adds up', () => {
    // The first row prints $12,000 owing, but the row itself is only $2,000.
    const r = analyse(row('28 Jul 2023', '28 Jul 2023', 'Original Activity Statement for the period ending 30 Jun 23', '$2,000.00', '', '$12,000.00 DR'))
    expect(r.debtBreakdown.openingBalance).toBe(10_000)
    expect(r.debtBreakdown.currentBalance).toBe(12_000)
    expect(reconciliationGap(r.debtBreakdown)).toBeNull()
  })

  it('is 0 for an export that starts from nothing', () => {
    expect(analyse(OPENING).debtBreakdown.openingBalance).toBe(0)
  })
})
