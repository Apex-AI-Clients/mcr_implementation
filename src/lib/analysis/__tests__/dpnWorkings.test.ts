import { describe, it, expect } from 'vitest'
import { dpnEstimateWorkings } from '../dpnWorkings'
import type { DpnRiskBreakdown } from '../types'

const base: DpnRiskBreakdown = {
  thresholdDays: 90,
  method: 'payments_oldest_first',
  contributingDebits: [],
  totalGrossLate: 268380,
  totalReducedByAmendments: 0,
  totalPaidByPayments: 268380,
  totalNetAtRisk: 0,
  window: {
    start: '2020-11-18',
    startBalance: 0,
    startUnder1000: '2020-11-18',
    startingCredit: 0,
    openingDebt: 0,
    payments: 308669.5,
    paymentsCount: 120,
    otherTaxDebts: 0,
    otherTaxDebtsPaid: 40289.5,
    grossLateAllHistory: 294309,
  },
  periodStart: null,
  periodEnd: null,
}

describe('dpnEstimateWorkings', () => {
  it('says in plain words when the late-lodged debt has been paid', () => {
    expect(dpnEstimateWorkings(base)).toEqual([
      'Since the balance was last nil (18 Nov 2020): $268,380 lodged more than 90 days late; $308,670 paid since.',
      'If the ATO applied payments to the oldest debts first, the late-lodged debt has been paid.',
      '$25,929 lodged more than 90 days late before then is treated as paid.',
      'For information: the balance was last $1,000 or less on 18 Nov 2020 (the same day).',
      'This is an estimate from the ATO account, not the ATO’s notice.',
    ])
  })

  it('says what is still unpaid, and where the payments went', () => {
    const lines = dpnEstimateWorkings({ ...base, totalPaidByPayments: 250323, totalNetAtRisk: 18057, window: { ...base.window!, otherTaxDebtsPaid: 58346.5 } })
    expect(lines?.[1]).toBe(
      'If the ATO applied payments to the oldest debts first, $18,057 of the late-lodged debt is still unpaid; $58,347 went first to other tax debts that fell due earlier.',
    )
  })

  it('names a credit balance and the credit held then', () => {
    const lines = dpnEstimateWorkings({ ...base, window: { ...base.window!, startBalance: -6648.58, startingCredit: 6648.58 } })
    expect(lines?.[0]).toBe(
      'Since the balance was last in credit (18 Nov 2020): $268,380 lodged more than 90 days late; $308,670 paid since, plus the $6,649 credit held then.',
    )
  })

  it('has nothing to say for an estimate stored before payments were counted', () => {
    expect(dpnEstimateWorkings({ ...base, method: undefined, window: undefined })).toBeNull()
  })
})
