import { describe, it, expect } from 'vitest'
import { cachedLeaveOneOut, caseSetKey, leaveOneOut } from '../accuracy'
import type { HistoricalSbrCase } from '../types'

/** The remembered leave-one-out accuracy. Synthetic cases only. */

function cases(n: number, shift = 0): HistoricalSbrCase[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `case-${i}`,
    clientName: `Example ${i}`,
    outcomePercent: ((i * 37 + shift) % 90) + 5,
    accepted: i % 4 !== 0,
    creditorAmount: 100_000 + i * 1_000,
    sbrPayment: 20_000 + i * 100,
    features: {
      dpn: i % 2 === 0,
      paymentPlanType: i % 3 === 0 ? 'upfront' : 'plan',
      directorLoanAtAppointment: i % 5 === 0,
      directorLoanReceivableAmount: (i * 911) % 50_000,
      cumulativeDaysLate: (i * 13) % 900,
      numberOfLateLodgements: i % 12,
      daysSinceLastPayment: (i * 7) % 400,
    },
  }))
}

describe('cachedLeaveOneOut', () => {
  it('gives the same answer as leaveOneOut, and reuses it for the same cases', () => {
    const set = cases(30)
    const first = cachedLeaveOneOut(set)
    expect(first).toEqual(leaveOneOut(set))
    // The very same object back: not computed again.
    expect(cachedLeaveOneOut(cases(30))).toBe(first)
  })

  it('works it out again when any case changes', () => {
    const before = cachedLeaveOneOut(cases(30))
    const after = cachedLeaveOneOut(cases(30, 11))
    expect(after).not.toBe(before)
    expect(after).toEqual(leaveOneOut(cases(30, 11)))
  })

  it('keys on everything the result depends on', () => {
    const base = cases(3)
    const changed = base.map((c, i) => (i === 1 ? { ...c, accepted: !c.accepted } : c))
    expect(caseSetKey(changed)).not.toBe(caseSetKey(base))
    const moved = base.map((c, i) => (i === 2 ? { ...c, features: { ...c.features, dpn: !c.features.dpn } } : c))
    expect(caseSetKey(moved)).not.toBe(caseSetKey(base))
  })
})
