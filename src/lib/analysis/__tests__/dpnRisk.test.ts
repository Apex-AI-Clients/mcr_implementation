import { describe, it, expect, beforeEach } from 'vitest'
import { computeDpnRisk as dpnRiskOf } from '../computeLateLodgement'
import type { EnrichedRow as Row } from '../types'

// These tests cover the DPN mechanics with amendment debits, so they run with
// amendments counted; the default setting (originals only) is covered in
// lateLodgementScope.test.ts and computeLateLodgement.test.ts.
const computeDpnRisk = (rows: Row[]) => dpnRiskOf(rows, 'originals_and_amendments')
import type { EnrichedRow, LodgementType } from '../types'

let _rowIdx = 0

const DESCRIPTION: Partial<Record<LodgementType, string>> = {
  Original: 'Original Activity Statement for the period ending 30 Jun 24 - GST',
  ClientAmended: 'Client initiated amended Activity Statement for the period ending 30 Jun 24 - GST',
  ATOAudit: 'Tax Office audit amended Activity Statement for the period ending 30 Jun 24',
}

beforeEach(() => {
  _rowIdx = 0
})

function buildRow(opts: {
  processedDate?: string
  daysLate?: number
  debit?: number
  credit?: number
  type: LodgementType
  description?: string
  /** The period ending, yyyy-mm-dd: credits only reduce debits of the same period. */
  period?: string
  /** The due (effective) date, yyyy-mm-dd: payments go to the oldest due first. Default: none (the processed date is used). */
  effective?: string
  /** The ATO's printed running balance (negative = in credit). */
  balance?: number
}): EnrichedRow {
  const daysLate = opts.daysLate ?? 0
  return {
    rowIndex: _rowIdx++,
    processedDate: opts.processedDate ? new Date(opts.processedDate) : null,
    effectiveDate: opts.effective ? new Date(opts.effective) : null,
    rawProcessed: opts.processedDate ?? '',
    rawEffective: '',
    // The ATO's wording by type: the late-lodgement rule (RBA ICA) reads the description.
    description: opts.description ?? DESCRIPTION[opts.type] ?? '',
    debit: opts.debit ?? null,
    credit: opts.credit ?? null,
    balance: opts.balance ?? null,
    periodEnding: opts.period ? new Date(`${opts.period}T00:00:00`) : null,
    lodgementType: opts.type,
    lateLodgementDays: daysLate,
    lateLodgeDaysCleaned: Math.max(daysLate, 0),
  }
}

// 1. Empty input → all zeros, no contributing debits
describe('computeDpnRisk — empty input', () => {
  it('returns zero totals, empty debits, null periods', () => {
    expect(computeDpnRisk([])).toEqual({
      thresholdDays: 90,
      method: 'payments_oldest_first',
      contributingDebits: [],
      totalGrossLate: 0,
      totalReducedByAmendments: 0,
      totalPaidByPayments: 0,
      totalNetAtRisk: 0,
      window: {
        start: null,
        startBalance: null,
        startUnder1000: null,
        startingCredit: 0,
        openingDebt: 0,
        payments: 0,
        paymentsCount: 0,
        otherTaxDebts: 0,
        otherTaxDebtsPaid: 0,
        grossLateAllHistory: 0,
      },
      periodStart: null,
      periodEnd: null,
    })
  })
})

// 2. Boundary: exactly 90 days → NOT included
describe('computeDpnRisk — threshold boundary', () => {
  it('exactly 90 days late is NOT included', () => {
    const row90 = buildRow({ processedDate: '2020-01-01', daysLate: 90, debit: 1000, type: 'Original' })
    expect(computeDpnRisk([row90]).contributingDebits).toHaveLength(0)
  })

  // 3. Boundary: 91 days → included
  it('91 days late IS included', () => {
    const row91 = buildRow({ processedDate: '2020-01-01', daysLate: 91, debit: 1000, type: 'Original' })
    expect(computeDpnRisk([row91]).totalGrossLate).toBe(1000)
  })
})

// 4. Credit-only late amendment is NOT a contributing debit, but its credit
//    DOES count toward the offset pool when combined with a late debit.
describe('computeDpnRisk — credit-only late amendment behaviour', () => {
  it('ClientAmended with credit only (debit=0) is not itself a contributing debit', () => {
    const creditOnly = buildRow({ processedDate: '2020-01-01', daysLate: 200, credit: 500, type: 'ClientAmended' })
    expect(computeDpnRisk([creditOnly]).contributingDebits).toHaveLength(0)
  })

  it('a credit-only amendment for the same period reduces a late debit', () => {
    const r = computeDpnRisk([
      buildRow({ processedDate: '2020-01-01', daysLate: 200, debit: 5000, type: 'ClientAmended', period: '2019-06-30' }),
      buildRow({ processedDate: '2021-01-01', daysLate: 300, credit: 1500, type: 'ClientAmended', period: '2019-06-30' }),
    ])
    expect(r.totalGrossLate).toBe(5000)
    expect(r.totalReducedByAmendments).toBe(1500)
    expect(r.totalNetAtRisk).toBe(3500)
  })
})

// 5. Single late debit, no payments after → net = gross
describe('computeDpnRisk — single late debit, no subsequent payments', () => {
  it('totalNetAtRisk equals totalGrossLate when there are no payments', () => {
    const r5 = computeDpnRisk([
      buildRow({ processedDate: '2020-01-01', daysLate: 200, debit: 5000, type: 'ClientAmended' }),
    ])
    expect(r5.totalGrossLate).toBe(5000)
    expect(r5.totalReducedByAmendments).toBe(0)
    expect(r5.totalNetAtRisk).toBe(5000)
  })
})

// 6. Payments since the window opened pay the late debt (16 Nov 2026: practitioner's method).
describe('computeDpnRisk — payments reduce the estimate', () => {
  it('a payment after the late debit pays it', () => {
    const r6 = computeDpnRisk([
      buildRow({ processedDate: '2020-01-01', daysLate: 200, debit: 5000, type: 'ClientAmended' }),
      buildRow({ processedDate: '2020-06-01', credit: 10000, type: 'Payment' }),
    ])
    expect(r6.totalGrossLate).toBe(5000)
    expect(r6.totalReducedByAmendments).toBe(0)
    expect(r6.totalPaidByPayments).toBe(5000)
    expect(r6.totalNetAtRisk).toBe(0)
    expect(r6.window?.payments).toBe(10000)
  })
})

// 7. A payment before the debt is held as a credit and applied when the debt arrives.
describe('computeDpnRisk — a surplus payment waits for the next debt', () => {
  it('payment on an earlier date pays the later debt', () => {
    const r7 = computeDpnRisk([
      buildRow({ processedDate: '2020-01-01', credit: 10000, type: 'Payment' }),
      buildRow({ processedDate: '2020-06-01', daysLate: 200, debit: 5000, type: 'ClientAmended' }),
    ])
    expect(r7.totalReducedByAmendments).toBe(0)
    expect(r7.totalNetAtRisk).toBe(0)
  })
})

// 8. Cash Flow Boost / GovernmentCredit does NOT count as a payment
describe('computeDpnRisk — GovernmentCredit excluded', () => {
  it('Cash Flow Boost / JobKeeper does not reduce DPN net', () => {
    const r8 = computeDpnRisk([
      buildRow({ processedDate: '2020-01-01', daysLate: 200, debit: 5000, type: 'ClientAmended' }),
      buildRow({ processedDate: '2020-06-01', credit: 10000, type: 'GovernmentCredit' }),
    ])
    expect(r8.totalReducedByAmendments).toBe(0)
    expect(r8.totalNetAtRisk).toBe(5000)
  })
})

// 9. CreditTransfer does NOT count as a payment
describe('computeDpnRisk — CreditTransfer excluded', () => {
  it('credit transfer from Income Tax Account does not reduce DPN net', () => {
    const r9 = computeDpnRisk([
      buildRow({ processedDate: '2020-01-01', daysLate: 200, debit: 5000, type: 'ClientAmended' }),
      buildRow({ processedDate: '2020-06-01', credit: 10000, type: 'CreditTransfer' }),
    ])
    expect(r9.totalReducedByAmendments).toBe(0)
    expect(r9.totalNetAtRisk).toBe(5000)
  })
})

// 10. GIC remission credit does NOT count as a payment
describe('computeDpnRisk — GIC remission excluded', () => {
  it('GIC remission does not reduce DPN net', () => {
    const r10 = computeDpnRisk([
      buildRow({ processedDate: '2020-01-01', daysLate: 200, debit: 5000, type: 'ClientAmended' }),
      buildRow({
        processedDate: '2020-06-01',
        credit: 10000,
        type: 'GIC',
        description: 'Remission of general interest charge',
      }),
    ])
    expect(r10.totalReducedByAmendments).toBe(0)
    expect(r10.totalNetAtRisk).toBe(5000)
  })
})

// 11. Payments in date order, to the debts already on the account, oldest due first.
describe('computeDpnRisk — payments, oldest debt first', () => {
  it('a payment reaches only the debts on the account when it is made; the rest waits', () => {
    const r11 = computeDpnRisk([
      buildRow({ processedDate: '2020-01-01', daysLate: 200, debit: 3000, type: 'ClientAmended' }),
      buildRow({ processedDate: '2020-06-01', credit: 1500, type: 'Payment' }),
      buildRow({ processedDate: '2021-01-01', daysLate: 200, debit: 2000, type: 'ClientAmended' }),
      buildRow({ processedDate: '2021-06-01', credit: 2000, type: 'Payment' }),
    ])
    expect(r11.totalGrossLate).toBe(5000)
    // 1,500 then 1,500 of the 2,000 to the first debt; 500 to the second.
    expect(r11.contributingDebits.map((d) => d.paidByPayments)).toEqual([3000, 500])
    expect(r11.totalNetAtRisk).toBe(1500)
  })

  it('an on-time debt due earlier takes the payment before a late debt due later', () => {
    const r = computeDpnRisk([
      buildRow({ processedDate: '2021-01-10', effective: '2021-01-01', debit: 4000, type: 'Original', period: '2020-12-31' }),
      buildRow({ processedDate: '2022-01-10', effective: '2021-04-01', daysLate: 284, debit: 3000, type: 'Original', period: '2021-03-31' }),
      buildRow({ processedDate: '2022-02-01', credit: 5000, type: 'Payment' }),
    ])
    expect(r.totalGrossLate).toBe(3000)
    expect(r.totalPaidByPayments).toBe(1000)
    expect(r.totalNetAtRisk).toBe(2000)
    expect(r.window?.otherTaxDebtsPaid).toBe(4000)
  })

  it('a late debt due earlier is paid before an on-time debt due later, whatever order they were lodged', () => {
    const r = computeDpnRisk([
      buildRow({ processedDate: '2021-07-10', effective: '2021-07-01', debit: 4000, type: 'Original', period: '2021-06-30' }),
      buildRow({ processedDate: '2022-01-10', effective: '2021-04-01', daysLate: 284, debit: 3000, type: 'Original', period: '2021-03-31' }),
      buildRow({ processedDate: '2022-02-01', credit: 5000, type: 'Payment' }),
    ])
    expect(r.totalNetAtRisk).toBe(0)
    expect(r.window?.otherTaxDebtsPaid).toBe(2000)
  })

  it('interest and penalties are not debts the payments go to', () => {
    const r = computeDpnRisk([
      buildRow({ processedDate: '2020-01-01', daysLate: 200, debit: 3000, type: 'Original' }),
      buildRow({ processedDate: '2020-02-01', debit: 900, type: 'GIC', description: 'General interest charge' }),
      buildRow({ processedDate: '2020-03-01', credit: 3000, type: 'Payment' }),
    ])
    expect(r.totalNetAtRisk).toBe(0)
  })

  it('a payment allocation row is not a second payment', () => {
    const r = computeDpnRisk([
      buildRow({ processedDate: '2020-01-01', daysLate: 200, debit: 3000, type: 'Original' }),
      buildRow({ processedDate: '2020-03-01', credit: 1000, type: 'Payment' }),
      buildRow({ processedDate: '2020-03-01', credit: 1000, type: 'PaymentAllocation' }),
    ])
    expect(r.window?.payments).toBe(1000)
    expect(r.totalNetAtRisk).toBe(2000)
  })

  it('PAYG withholding (STP reported) is a tax debt the payments go to, never a late lodgement', () => {
    const r = computeDpnRisk([
      buildRow({ processedDate: '2021-01-10', effective: '2021-01-01', debit: 2000, type: 'PAYGWithholding', daysLate: 0, description: 'PAYG Withholding (STP Reported) for period ending 31 Dec 20' }),
      buildRow({ processedDate: '2022-01-10', effective: '2021-04-01', daysLate: 284, debit: 3000, type: 'Original', period: '2021-03-31' }),
      buildRow({ processedDate: '2022-02-01', credit: 3000, type: 'Payment' }),
    ])
    expect(r.contributingDebits).toHaveLength(1)
    expect(r.totalNetAtRisk).toBe(2000)
    expect(r.window?.otherTaxDebtsPaid).toBe(2000)
  })
})

// The window: since the ATO balance was last nil or in credit.
describe('computeDpnRisk — window since the balance was last nil', () => {
  it('treats late debt before the last nil balance as paid, and counts only payments after it', () => {
    // Newest first, as the ATO lists them.
    const rows = [
      buildRow({ processedDate: '2022-03-01', credit: 500, type: 'Payment', balance: 3500 }),
      buildRow({ processedDate: '2022-01-10', daysLate: 284, debit: 4000, type: 'Original', balance: 4000 }),
      buildRow({ processedDate: '2021-06-01', credit: 7000, type: 'Payment', balance: 0 }),
      buildRow({ processedDate: '2021-01-10', daysLate: 200, debit: 7000, type: 'Original', balance: 7000 }),
    ]
    const r = computeDpnRisk(rows)
    expect(r.window?.start).toBe('2021-06-01')
    expect(r.window?.startBalance).toBe(0)
    expect(r.window?.payments).toBe(500)
    expect(r.window?.grossLateAllHistory).toBe(11000)
    expect(r.totalGrossLate).toBe(4000)
    expect(r.totalNetAtRisk).toBe(3500)
  })

  it('applies a credit held at the start like a payment, and reports the last date at or under $1,000', () => {
    const rows = [
      buildRow({ processedDate: '2022-01-10', daysLate: 284, debit: 4000, type: 'Original', balance: 3000 }),
      buildRow({ processedDate: '2021-09-01', debit: 1500, type: 'GIC', description: 'General interest charge', balance: -1000 + 1500 }),
      buildRow({ processedDate: '2021-06-01', credit: 1000, type: 'GovernmentCredit', balance: -1000 }),
    ]
    const r = computeDpnRisk(rows)
    expect(r.window?.start).toBe('2021-06-01')
    expect(r.window?.startingCredit).toBe(1000)
    expect(r.window?.startUnder1000).toBe('2021-09-01')
    expect(r.totalNetAtRisk).toBe(3000)
  })

  it('with no nil balance, the export opens owing its first balance, the oldest debt', () => {
    const rows = [
      buildRow({ processedDate: '2022-03-01', credit: 3000, type: 'Payment', balance: 6000 }),
      buildRow({ processedDate: '2022-01-10', daysLate: 284, debit: 4000, type: 'Original', balance: 9000 }),
      buildRow({ processedDate: '2021-06-01', debit: 5000, type: 'GIC', description: 'General interest charge', balance: 5000 }),
    ]
    const r = computeDpnRisk(rows)
    expect(r.window?.start).toBeNull()
    // The first printed balance (5,000 on 1 Jun 2021) less the interest charged that day: nothing owed before.
    expect(r.window?.openingDebt).toBe(0)
    expect(r.totalNetAtRisk).toBe(1000)

    const owing = computeDpnRisk([
      buildRow({ processedDate: '2022-03-01', credit: 3000, type: 'Payment', balance: 9000 }),
      buildRow({ processedDate: '2022-01-10', daysLate: 284, debit: 4000, type: 'Original', balance: 12000 }),
      buildRow({ processedDate: '2021-06-01', debit: 5000, type: 'GIC', description: 'General interest charge', balance: 8000 }),
    ])
    expect(owing.window?.openingDebt).toBe(3000)
    // The 3,000 payment clears the 3,000 owed when the export opens; the late debt is untouched.
    expect(owing.totalNetAtRisk).toBe(4000)
  })
})

// 12. Same-period netting: a credit only ever reduces a debit for the SAME period.
describe('computeDpnRisk — same-period netting', () => {
  it('a credit for another period does not reduce a late debit', () => {
    const r = computeDpnRisk([
      buildRow({ processedDate: '2020-01-01', daysLate: 200, debit: 1000, type: 'Original', period: '2019-06-30' }),
      buildRow({ processedDate: '2021-01-01', daysLate: 200, credit: 100000, type: 'ClientAmended', period: '2020-06-30' }),
    ])
    expect(r.totalGrossLate).toBe(1000)
    expect(r.totalReducedByAmendments).toBe(0)
    expect(r.totalNetAtRisk).toBe(1000)
  })

  it("caps the reduction at the period's own late debit", () => {
    const r = computeDpnRisk([
      buildRow({ processedDate: '2020-01-01', daysLate: 200, debit: 1000, type: 'Original', period: '2019-06-30' }),
      buildRow({ processedDate: '2021-01-01', daysLate: 200, credit: 100000, type: 'ClientAmended', period: '2019-06-30' }),
    ])
    expect(r.contributingDebits[0].reducedByAmendments).toBe(1000)
    expect(r.totalReducedByAmendments).toBe(1000)
    expect(r.totalNetAtRisk).toBe(0)
  })

  it("applies a period's reduction to its late debits in date order, never to another period", () => {
    const r = computeDpnRisk([
      buildRow({ processedDate: '2020-01-01', daysLate: 200, debit: 3000, type: 'ClientAmended', period: '2019-06-30' }),
      buildRow({ processedDate: '2020-03-01', daysLate: 200, debit: 1000, type: 'ClientAmended', period: '2019-06-30' }),
      buildRow({ processedDate: '2021-01-01', daysLate: 200, debit: 2000, type: 'ClientAmended', period: '2019-09-30' }),
      buildRow({ processedDate: '2022-01-01', daysLate: 300, credit: 3500, type: 'ClientAmended', period: '2019-06-30' }),
    ])
    expect(r.totalGrossLate).toBe(6000)
    expect(r.contributingDebits.map((d) => d.reducedByAmendments)).toEqual([3000, 500, 0])
    expect(r.contributingDebits.map((d) => d.netAtRisk)).toEqual([0, 500, 2000])
    expect(r.totalReducedByAmendments).toBe(3500)
    expect(r.totalNetAtRisk).toBe(2500)
  })

  it('gives no reduction to a row with no period ending', () => {
    const r = computeDpnRisk([
      buildRow({ processedDate: '2020-01-01', daysLate: 200, debit: 1000, type: 'Original' }),
      buildRow({ processedDate: '2021-01-01', daysLate: 200, credit: 1000, type: 'ClientAmended' }),
    ])
    expect(r.totalNetAtRisk).toBe(1000)
  })

  it('counting originals only, an amendment that went up and back down reduces nothing', () => {
    const rows = [
      buildRow({ processedDate: '2020-01-01', daysLate: 200, debit: 5000, type: 'Original', period: '2019-06-30' }),
      buildRow({ processedDate: '2020-06-01', daysLate: 300, debit: 2000, type: 'ClientAmended', period: '2019-06-30' }),
      buildRow({ processedDate: '2020-09-01', daysLate: 400, credit: 2000, type: 'ClientAmended', period: '2019-06-30' }),
    ]
    const originalsOnly = dpnRiskOf(rows, 'originals_only')
    expect(originalsOnly.totalGrossLate).toBe(5000)
    expect(originalsOnly.totalReducedByAmendments).toBe(0)
    expect(originalsOnly.totalNetAtRisk).toBe(5000)
  })

  it('counting originals only, a net downward amendment reduces the original', () => {
    const rows = [
      buildRow({ processedDate: '2020-01-01', daysLate: 200, debit: 5000, type: 'Original', period: '2019-06-30' }),
      buildRow({ processedDate: '2020-06-01', daysLate: 300, debit: 500, type: 'ClientAmended', period: '2019-06-30' }),
      buildRow({ processedDate: '2020-09-01', daysLate: 400, credit: 2000, type: 'ClientAmended', period: '2019-06-30' }),
    ]
    const r = dpnRiskOf(rows, 'originals_only')
    expect(r.totalReducedByAmendments).toBe(1500)
    expect(r.totalNetAtRisk).toBe(3500)
  })
})
