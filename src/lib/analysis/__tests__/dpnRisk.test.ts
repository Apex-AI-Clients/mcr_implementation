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

// 4. Credit-only late amendment is NOT a contributing debit
describe('computeDpnRisk — credit-only late amendment excluded', () => {
  it('ClientAmended with credit only (debit=0) does not qualify', () => {
    const creditOnly = buildRow({ processedDate: '2020-01-01', daysLate: 200, credit: 500, type: 'ClientAmended' })
    expect(computeDpnRisk([creditOnly]).contributingDebits).toHaveLength(0)
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

// 6. Single late debit, payments AFTER fully cover it → net = 0
describe('computeDpnRisk — payments after lodgement fully cover the debit', () => {
  it('totalPaidSince is capped at debit amount; net = 0', () => {
    const r6 = computeDpnRisk([
      buildRow({ processedDate: '2020-01-01', daysLate: 200, debit: 5000, type: 'ClientAmended' }),
      buildRow({ processedDate: '2020-06-01', credit: 10000, type: 'Payment' }),
    ])
    expect(r6.totalGrossLate).toBe(5000)
    expect(r6.totalPaidSince).toBe(5000) // CAPPED at debit
    expect(r6.totalNetAtRisk).toBe(0)
  })
})

// 7. Payment BEFORE the lodgement does NOT count
describe('computeDpnRisk — payment before lodgement date is excluded', () => {
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

// 11. Multiple late debits — each measured against payments after ITS OWN date
describe('computeDpnRisk — multiple late debits with per-row netting', () => {
  it('each debit is independently netted against payments after its own date', () => {
    const r11 = computeDpnRisk([
      buildRow({ processedDate: '2020-01-01', daysLate: 200, debit: 3000, type: 'ClientAmended' }),
      buildRow({ processedDate: '2021-01-01', daysLate: 200, debit: 2000, type: 'ClientAmended' }),
      // Payment between the two — counts for the first, not the second
      buildRow({ processedDate: '2020-06-01', credit: 1500, type: 'Payment' }),
      // Payment after both — counts for both
      buildRow({ processedDate: '2021-06-01', credit: 2000, type: 'Payment' }),
    ])
    // First debit (3000): payments since 2020-01-01 = 1500 + 2000 = 3500, capped at 3000
    // Second debit (2000): payments since 2021-01-01 = 2000, capped at 2000
    expect(r11.totalGrossLate).toBe(5000)
    expect(r11.totalPaidSince).toBe(5000)
    expect(r11.totalNetAtRisk).toBe(0)
  })
})

// 12. Cap is per-row, not pooled
describe('computeDpnRisk — cap is per-row', () => {
  it('a massive payment only reduces the debit to zero, not the whole pool', () => {
    const r12 = computeDpnRisk([
      buildRow({ processedDate: '2020-01-01', daysLate: 200, debit: 1000, type: 'Original' }),
      buildRow({ processedDate: '2020-06-01', credit: 100000, type: 'Payment' }),
    ])
    expect(r12.contributingDebits[0].paymentsSinceLodged).toBe(1000) // capped
    expect(r12.totalPaidSince).toBe(1000) // not 100000
  })
})
