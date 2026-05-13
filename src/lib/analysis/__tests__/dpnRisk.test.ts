import { describe, it, expect } from 'vitest'
import { computeDpnRisk } from '../computeLateLodgement'
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

describe('computeDpnRisk — empty input', () => {
  it('returns zero totals and null period on empty array', () => {
    const result = computeDpnRisk([])
    expect(result.totalGrossLate).toBe(0)
    expect(result.totalReversed).toBe(0)
    expect(result.totalNetAtRisk).toBe(0)
    expect(result.contributingRows).toHaveLength(0)
    expect(result.periodStart).toBeNull()
    expect(result.periodEnd).toBeNull()
  })
})

describe('computeDpnRisk — threshold boundary', () => {
  it('exactly 90 days late is NOT included', () => {
    const result = computeDpnRisk([
      makeRow({
        rowIndex: 0,
        lodgementType: 'Original',
        processedDate: new Date('2024-01-01'),
        debit: 1000,
        lateLodgementDays: 90,
        lateLodgeDaysCleaned: 90,
      }),
    ])
    expect(result.contributingRows).toHaveLength(0)
    expect(result.totalGrossLate).toBe(0)
  })

  it('91 days late IS included', () => {
    const result = computeDpnRisk([
      makeRow({
        rowIndex: 0,
        lodgementType: 'Original',
        processedDate: new Date('2024-01-01'),
        debit: 500,
        lateLodgementDays: 91,
        lateLodgeDaysCleaned: 91,
      }),
    ])
    expect(result.contributingRows).toHaveLength(1)
    expect(result.totalGrossLate).toBe(500)
  })
})

describe('computeDpnRisk — non-lodgement types excluded', () => {
  it('GIC, Payment, SubLine, ATOAmended are never included even if >90 days', () => {
    const rows: EnrichedRow[] = [
      makeRow({ rowIndex: 0, lodgementType: 'GIC', debit: 1000, lateLodgementDays: 365, lateLodgeDaysCleaned: 365 }),
      makeRow({ rowIndex: 1, lodgementType: 'Payment', credit: 500, lateLodgementDays: 0, lateLodgeDaysCleaned: 0 }),
      makeRow({ rowIndex: 2, lodgementType: 'SubLine', debit: 200, lateLodgementDays: 365, lateLodgeDaysCleaned: 365 }),
      makeRow({ rowIndex: 3, lodgementType: 'ATOAmended', debit: 800, lateLodgementDays: 365, lateLodgeDaysCleaned: 365 }),
    ]
    const result = computeDpnRisk(rows)
    expect(result.contributingRows).toHaveLength(0)
    expect(result.totalGrossLate).toBe(0)
  })
})

describe('computeDpnRisk — PARKCON reference case', () => {
  it('produces $9,408 gross / $8,534 reversed / $874 net', () => {
    const rows: EnrichedRow[] = [
      // Row 0: Original, 178 days, debit $9,408 — qualifies
      makeRow({
        rowIndex: 0,
        lodgementType: 'Original',
        processedDate: new Date('2019-02-21'),
        effectiveDate: new Date('2018-08-27'),
        debit: 9408,
        credit: null,
        lateLodgementDays: 178,
        lateLodgeDaysCleaned: 178,
      }),
      // Row 3: ClientAmended, 471 days, credit $4,144 — qualifies (credit row)
      makeRow({
        rowIndex: 3,
        lodgementType: 'ClientAmended',
        processedDate: new Date('2020-03-11'),
        effectiveDate: new Date('2018-11-26'),
        debit: null,
        credit: 4144,
        lateLodgementDays: 471,
        lateLodgeDaysCleaned: 471,
      }),
      // Row 5: Original, 24 days — does NOT qualify (<90)
      makeRow({
        rowIndex: 5,
        lodgementType: 'Original',
        processedDate: new Date('2021-03-26'),
        debit: 7500,
        lateLodgementDays: 24,
        lateLodgeDaysCleaned: 24,
      }),
      // Row 10: ClientAmended, 474 days, credit $4,390 — qualifies (credit row)
      makeRow({
        rowIndex: 10,
        lodgementType: 'ClientAmended',
        processedDate: new Date('2024-12-11'),
        effectiveDate: new Date('2023-08-25'),
        debit: null,
        credit: 4390,
        lateLodgementDays: 474,
        lateLodgeDaysCleaned: 474,
      }),
    ]

    const result = computeDpnRisk(rows)

    expect(result.contributingRows).toHaveLength(3)
    expect(result.totalGrossLate).toBe(9408)
    expect(result.totalReversed).toBe(4144 + 4390)  // 8534
    expect(result.totalNetAtRisk).toBe(874)
  })
})

describe('computeDpnRisk — net floored at zero', () => {
  it('when credits exceed debits, totalNetAtRisk is 0 not negative', () => {
    const rows: EnrichedRow[] = [
      makeRow({
        rowIndex: 0,
        lodgementType: 'Original',
        processedDate: new Date('2024-01-01'),
        debit: 1000,
        lateLodgementDays: 200,
        lateLodgeDaysCleaned: 200,
      }),
      makeRow({
        rowIndex: 1,
        lodgementType: 'ClientAmended',
        processedDate: new Date('2024-06-01'),
        credit: 5000,
        lateLodgementDays: 365,
        lateLodgeDaysCleaned: 365,
      }),
    ]
    const result = computeDpnRisk(rows)
    expect(result.totalGrossLate).toBe(1000)
    expect(result.totalReversed).toBe(5000)
    expect(result.totalNetAtRisk).toBe(0)
  })
})

describe('computeDpnRisk — periodStart / periodEnd', () => {
  it('uses the full range of ALL rows, not just contributing rows', () => {
    const rows: EnrichedRow[] = [
      // This row qualifies for DPN
      makeRow({
        rowIndex: 0,
        lodgementType: 'Original',
        processedDate: new Date('2022-06-01'),
        debit: 2000,
        lateLodgementDays: 200,
        lateLodgeDaysCleaned: 200,
      }),
      // Payment — does not qualify for DPN but extends the period range
      makeRow({
        rowIndex: 1,
        lodgementType: 'Payment',
        processedDate: new Date('2019-01-01'),
        credit: 500,
        lateLodgementDays: 0,
        lateLodgeDaysCleaned: 0,
      }),
      makeRow({
        rowIndex: 2,
        lodgementType: 'GIC',
        processedDate: new Date('2025-12-01'),
        debit: 100,
        lateLodgementDays: 0,
        lateLodgeDaysCleaned: 0,
      }),
    ]
    const result = computeDpnRisk(rows)
    expect(new Date(result.periodStart!).getFullYear()).toBe(2019)
    expect(new Date(result.periodEnd!).getFullYear()).toBe(2025)
  })

  it('returns null period when all rows have null processedDate', () => {
    const rows: EnrichedRow[] = [
      makeRow({ rowIndex: 0, lodgementType: 'GIC', lateLodgementDays: 0, lateLodgeDaysCleaned: 0 }),
    ]
    const result = computeDpnRisk(rows)
    expect(result.periodStart).toBeNull()
    expect(result.periodEnd).toBeNull()
  })
})
