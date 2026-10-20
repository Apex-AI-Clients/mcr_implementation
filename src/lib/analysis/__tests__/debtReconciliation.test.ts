import { describe, expect, it } from 'vitest'
import { composedBalance, reconciliationGap } from '../debtReconciliation'
import type { DebtBreakdown } from '../types'

/** Synthetic figures only. */
function db(overrides: Partial<DebtBreakdown>): DebtBreakdown {
  return {
    principalDebits: 0,
    principalCredits: 0,
    principalNet: 0,
    interestDebits: 0,
    interestCredits: 0,
    interestNet: 0,
    penaltyDebits: 0,
    penaltyCredits: 0,
    penaltyNet: 0,
    auditDebits: 0,
    auditCredits: 0,
    auditNet: 0,
    paymentsReceived: 0,
    paymentsCount: 0,
    firstPaymentDate: null,
    lastPaymentDate: null,
    governmentCredits: 0,
    otherCredits: 0,
    totalAtoDebt: 0,
    refundsPaid: 0,
    openingBalance: 0,
    composedBalance: 0,
    atoBalance: null,
    atoBalanceDate: null,
    unexplainedDifference: null,
    currentBalance: 0,
    ...overrides,
  }
}

describe('reconciliationGap', () => {
  it('is the line that makes the table add up to the ATO balance', () => {
    const d = db({ totalAtoDebt: 200_000, paymentsReceived: 50_000, governmentCredits: 1_000, currentBalance: 149_412.17 })
    expect(composedBalance(d)).toBe(149_000)
    expect(reconciliationGap(d)).toBe(412.17)
    // Composition + gap = the balance shown.
    expect(composedBalance(d) + reconciliationGap(d)!).toBeCloseTo(d.currentBalance, 2)
  })

  it('can be negative, when the ATO balance is lower than the rows add up to', () => {
    expect(reconciliationGap(db({ totalAtoDebt: 10_000, currentBalance: 9_500 }))).toBe(-500)
  })

  it('needs no line within a dollar', () => {
    expect(reconciliationGap(db({ totalAtoDebt: 10_000, currentBalance: 10_000.99 }))).toBeNull()
    expect(reconciliationGap(db({ totalAtoDebt: 10_000, currentBalance: 10_001.5 }))).toBe(1.5)
  })

  it('needs no line for an analysis saved before the ATO balance was used', () => {
    // Then the balance was the composition itself.
    expect(reconciliationGap(db({ totalAtoDebt: 80_000, paymentsReceived: 30_000, currentBalance: 50_000 }))).toBeNull()
  })
})
