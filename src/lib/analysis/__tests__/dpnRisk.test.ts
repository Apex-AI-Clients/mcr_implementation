import { describe, it, expect, beforeEach } from 'vitest'
import { computeDpnRisk as dpnRiskOf } from '../computeLateLodgement'
import type { EnrichedRow as Row } from '../types'

// These tests cover the DPN mechanics with amendment debits, so they run with
// amendments counted; the default setting (originals only) is covered in
// lateLodgementScope.test.ts and computeLateLodgement.test.ts.
const computeDpnRisk = (rows: Row[]) => dpnRiskOf(rows, 'originals_and_amendments')
import type { EnrichedRow, LodgementType } from '../types'

let _rowIdx = 0

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
}): EnrichedRow {
  const daysLate = opts.daysLate ?? 0
  return {
    rowIndex: _rowIdx++,
    processedDate: opts.processedDate ? new Date(opts.processedDate) : null,
    effectiveDate: null,
    rawProcessed: opts.processedDate ?? '',
    rawEffective: '',
    description: opts.description ?? '',
    debit: opts.debit ?? null,
    credit: opts.credit ?? null,
    balance: null,
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
      contributingDebits: [],
      totalGrossLate: 0,
      totalReducedByAmendments: 0,
      totalNetAtRisk: 0,
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

// 6. Cash Payments are NOT counted toward DPN relief (could have gone to older debt)
describe('computeDpnRisk — cash Payments do not reduce DPN net', () => {
  it('a Payment row after the late debit is ignored — only late-credit ClientAmended rows offset', () => {
    const r6 = computeDpnRisk([
      buildRow({ processedDate: '2020-01-01', daysLate: 200, debit: 5000, type: 'ClientAmended' }),
      buildRow({ processedDate: '2020-06-01', credit: 10000, type: 'Payment' }),
    ])
    expect(r6.totalGrossLate).toBe(5000)
    expect(r6.totalReducedByAmendments).toBe(0)
    expect(r6.totalNetAtRisk).toBe(5000)
  })
})

// 7. Payment BEFORE the lodgement also doesn't count (same rationale)
describe('computeDpnRisk — payment date is irrelevant; payments never count', () => {
  it('payment on an earlier date does not reduce net', () => {
    const r7 = computeDpnRisk([
      buildRow({ processedDate: '2020-01-01', credit: 10000, type: 'Payment' }),
      buildRow({ processedDate: '2020-06-01', daysLate: 200, debit: 5000, type: 'ClientAmended' }),
    ])
    expect(r7.totalReducedByAmendments).toBe(0)
    expect(r7.totalNetAtRisk).toBe(5000)
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

// 11. Multiple late debits — cash payments don't count; pool excludes Payment rows.
describe('computeDpnRisk — cash payments never reduce DPN', () => {
  it('Payment rows are ignored regardless of when they processed', () => {
    const r11 = computeDpnRisk([
      buildRow({ processedDate: '2020-01-01', daysLate: 200, debit: 3000, type: 'ClientAmended' }),
      buildRow({ processedDate: '2021-01-01', daysLate: 200, debit: 2000, type: 'ClientAmended' }),
      buildRow({ processedDate: '2020-06-01', credit: 1500, type: 'Payment' }),
      buildRow({ processedDate: '2021-06-01', credit: 2000, type: 'Payment' }),
    ])
    expect(r11.totalGrossLate).toBe(5000)
    expect(r11.totalReducedByAmendments).toBe(0)
    expect(r11.totalNetAtRisk).toBe(5000)
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
