import { describe, it, expect, beforeEach } from 'vitest'
import { computeDpnRisk } from '../computeLateLodgement'
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
    periodEnding: null,
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
      totalPaidSince: 0,
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

  it('late credit-only ClientAmended offsets a late debit', () => {
    const r = computeDpnRisk([
      buildRow({ processedDate: '2020-01-01', daysLate: 200, debit: 5000, type: 'ClientAmended' }),
      buildRow({ processedDate: '2021-01-01', daysLate: 300, credit: 1500, type: 'ClientAmended' }),
    ])
    expect(r.totalGrossLate).toBe(5000)
    expect(r.totalPaidSince).toBe(1500)
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
    expect(r5.totalPaidSince).toBe(0)
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
    expect(r6.totalPaidSince).toBe(0)
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
    expect(r7.totalPaidSince).toBe(0)
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
    expect(r8.totalPaidSince).toBe(0)
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
    expect(r9.totalPaidSince).toBe(0)
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
    expect(r10.totalPaidSince).toBe(0)
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
    expect(r11.totalPaidSince).toBe(0)
    expect(r11.totalNetAtRisk).toBe(5000)
  })
})

// 12. Pooled credit allocation: late credits apply oldest-debit-first, capped at total gross.
describe('computeDpnRisk — pooled late-credit allocation', () => {
  it('a late credit-only ClientAmended pool larger than gross caps at total gross', () => {
    const r12 = computeDpnRisk([
      buildRow({ processedDate: '2020-01-01', daysLate: 200, debit: 1000, type: 'Original' }),
      buildRow({ processedDate: '2021-01-01', daysLate: 200, credit: 100000, type: 'ClientAmended' }),
    ])
    expect(r12.contributingDebits[0].paymentsSinceLodged).toBe(1000)
    expect(r12.totalPaidSince).toBe(1000)
    expect(r12.totalNetAtRisk).toBe(0)
  })

  it('credits apply to oldest debit first across multiple contributing debits', () => {
    const r = computeDpnRisk([
      buildRow({ processedDate: '2020-01-01', daysLate: 200, debit: 3000, type: 'ClientAmended' }),
      buildRow({ processedDate: '2021-01-01', daysLate: 200, debit: 2000, type: 'ClientAmended' }),
      buildRow({ processedDate: '2022-01-01', daysLate: 300, credit: 3500, type: 'ClientAmended' }),
    ])
    expect(r.totalGrossLate).toBe(5000)
    expect(r.totalPaidSince).toBe(3500)
    expect(r.totalNetAtRisk).toBe(1500)
    // Oldest debit ($3000) gets first $3000 of pool; newer debit gets remaining $500
    expect(r.contributingDebits[0].paymentsSinceLodged).toBe(3000)
    expect(r.contributingDebits[0].netAtRisk).toBe(0)
    expect(r.contributingDebits[1].paymentsSinceLodged).toBe(500)
    expect(r.contributingDebits[1].netAtRisk).toBe(1500)
  })
})
