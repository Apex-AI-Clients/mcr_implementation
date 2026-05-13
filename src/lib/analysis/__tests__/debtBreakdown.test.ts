import { describe, it, expect } from 'vitest'
import { computeDebtBreakdown } from '../computeLateLodgement'
import type { EnrichedRow, LodgementType } from '../types'

function makeRow(
  overrides: Partial<EnrichedRow> & { rowIndex: number; lodgementType: LodgementType },
): EnrichedRow {
  return {
    processedDate: null,
    effectiveDate: null,
    rawProcessed: '',
    rawEffective: '',
    description: '',
    debit: null,
    credit: null,
    balance: null,
    periodEnding: null,
    lateLodgementDays: 0,
    lateLodgeDaysCleaned: 0,
    ...overrides,
  }
}

describe('computeDebtBreakdown — principal', () => {
  it('sums Original + ClientAmended debits into principalDebits', () => {
    const rows: EnrichedRow[] = [
      makeRow({ rowIndex: 0, lodgementType: 'Original', debit: 1000 }),
      makeRow({ rowIndex: 1, lodgementType: 'ClientAmended', debit: 500 }),
    ]
    const result = computeDebtBreakdown(rows)
    expect(result.principalDebits).toBe(1500)
    expect(result.principalCredits).toBe(0)
    expect(result.principalNet).toBe(1500)
  })

  it('sums Original + ClientAmended credits into principalCredits', () => {
    const rows: EnrichedRow[] = [
      makeRow({ rowIndex: 0, lodgementType: 'Original', debit: 2000 }),
      makeRow({ rowIndex: 1, lodgementType: 'ClientAmended', credit: 800 }),
    ]
    const result = computeDebtBreakdown(rows)
    expect(result.principalDebits).toBe(2000)
    expect(result.principalCredits).toBe(800)
    expect(result.principalNet).toBe(1200)
  })

  it('ATOAmended rows are excluded from principal', () => {
    const rows: EnrichedRow[] = [
      makeRow({ rowIndex: 0, lodgementType: 'Original', debit: 1000 }),
      makeRow({ rowIndex: 1, lodgementType: 'ATOAmended', debit: 2000 }),
      makeRow({ rowIndex: 2, lodgementType: 'ATOAmended', credit: 500 }),
    ]
    const result = computeDebtBreakdown(rows)
    expect(result.principalDebits).toBe(1000)
    expect(result.principalCredits).toBe(0)
  })

  it('SubLine rows are excluded from principal', () => {
    const rows: EnrichedRow[] = [
      makeRow({ rowIndex: 0, lodgementType: 'Original', debit: 1000 }),
      makeRow({ rowIndex: 1, lodgementType: 'SubLine', debit: 999 }),
    ]
    const result = computeDebtBreakdown(rows)
    expect(result.principalDebits).toBe(1000)
  })
})

describe('computeDebtBreakdown — interest', () => {
  it('sums GIC debits and credits separately', () => {
    const rows: EnrichedRow[] = [
      makeRow({ rowIndex: 0, lodgementType: 'GIC', debit: 120 }),
      makeRow({ rowIndex: 1, lodgementType: 'GIC', debit: 80 }),
      makeRow({ rowIndex: 2, lodgementType: 'GIC', credit: 30 }), // remission
    ]
    const result = computeDebtBreakdown(rows)
    expect(result.interestDebits).toBe(200)
    expect(result.interestCredits).toBe(30)
    expect(result.interestNet).toBe(170)
  })
})

describe('computeDebtBreakdown — penalties', () => {
  it('sums FTLPenalty + GeneralPenalty debits', () => {
    const rows: EnrichedRow[] = [
      makeRow({ rowIndex: 0, lodgementType: 'FTLPenalty', debit: 300 }),
      makeRow({ rowIndex: 1, lodgementType: 'GeneralPenalty', debit: 150 }),
    ]
    const result = computeDebtBreakdown(rows)
    expect(result.penaltyDebits).toBe(450)
    expect(result.penaltyNet).toBe(450)
  })
})

describe('computeDebtBreakdown — payments and other credits', () => {
  it('Payment credits go to paymentsReceived', () => {
    const rows: EnrichedRow[] = [
      makeRow({ rowIndex: 0, lodgementType: 'Payment', credit: 3500 }),
      makeRow({ rowIndex: 1, lodgementType: 'Payment', credit: 500 }),
    ]
    const result = computeDebtBreakdown(rows)
    expect(result.paymentsReceived).toBe(4000)
  })

  it('CreditTransfer credits go to otherCredits', () => {
    const rows: EnrichedRow[] = [
      makeRow({ rowIndex: 0, lodgementType: 'CreditTransfer', credit: 1000 }),
    ]
    const result = computeDebtBreakdown(rows)
    expect(result.otherCredits).toBe(1000)
    expect(result.paymentsReceived).toBe(0)
  })

  it('Other credits also go to otherCredits', () => {
    const rows: EnrichedRow[] = [
      makeRow({ rowIndex: 0, lodgementType: 'Other', credit: 200 }),
    ]
    const result = computeDebtBreakdown(rows)
    expect(result.otherCredits).toBe(200)
  })
})

describe('computeDebtBreakdown — totalAtoDebt and currentBalance', () => {
  it('totalAtoDebt = principalNet + interestNet + penaltyNet', () => {
    const rows: EnrichedRow[] = [
      makeRow({ rowIndex: 0, lodgementType: 'Original', debit: 5000 }),
      makeRow({ rowIndex: 1, lodgementType: 'GIC', debit: 200 }),
      makeRow({ rowIndex: 2, lodgementType: 'FTLPenalty', debit: 300 }),
    ]
    const result = computeDebtBreakdown(rows)
    expect(result.totalAtoDebt).toBe(5500)
  })

  it('currentBalance = max(totalAtoDebt - paymentsReceived - otherCredits, 0)', () => {
    const rows: EnrichedRow[] = [
      makeRow({ rowIndex: 0, lodgementType: 'Original', debit: 5000 }),
      makeRow({ rowIndex: 1, lodgementType: 'GIC', debit: 200 }),
      makeRow({ rowIndex: 2, lodgementType: 'Payment', credit: 2000 }),
      makeRow({ rowIndex: 3, lodgementType: 'CreditTransfer', credit: 500 }),
    ]
    const result = computeDebtBreakdown(rows)
    expect(result.totalAtoDebt).toBe(5200)
    expect(result.currentBalance).toBe(2700)
  })

  it('currentBalance is floored at 0, never negative', () => {
    const rows: EnrichedRow[] = [
      makeRow({ rowIndex: 0, lodgementType: 'Original', debit: 100 }),
      makeRow({ rowIndex: 1, lodgementType: 'Payment', credit: 99999 }),
    ]
    const result = computeDebtBreakdown(rows)
    expect(result.currentBalance).toBe(0)
  })
})

describe('computeDebtBreakdown — empty input', () => {
  it('returns all-zero breakdown', () => {
    const result = computeDebtBreakdown([])
    expect(result.principalDebits).toBe(0)
    expect(result.principalCredits).toBe(0)
    expect(result.principalNet).toBe(0)
    expect(result.interestDebits).toBe(0)
    expect(result.interestCredits).toBe(0)
    expect(result.interestNet).toBe(0)
    expect(result.penaltyDebits).toBe(0)
    expect(result.penaltyCredits).toBe(0)
    expect(result.penaltyNet).toBe(0)
    expect(result.paymentsReceived).toBe(0)
    expect(result.otherCredits).toBe(0)
    expect(result.totalAtoDebt).toBe(0)
    expect(result.currentBalance).toBe(0)
  })
})

describe('computeDebtBreakdown — null debit/credit', () => {
  it('null values are treated as zero', () => {
    const rows: EnrichedRow[] = [
      makeRow({ rowIndex: 0, lodgementType: 'Original', debit: null }),
      makeRow({ rowIndex: 1, lodgementType: 'Payment', credit: null }),
    ]
    const result = computeDebtBreakdown(rows)
    expect(result.principalDebits).toBe(0)
    expect(result.paymentsReceived).toBe(0)
  })
})
