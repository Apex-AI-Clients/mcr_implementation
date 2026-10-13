// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { leaveOneOut } from '../accuracy'
import { trainingSet, type TrainingRow } from '../historicalCases'
import { caseRows, growthPoints, shareOf } from '../predictionData'
import { RISK_BAND_RULE, bandForRejectedNeighbours, describeRiskBandRule } from '../riskBands'
import type { ImportHistoryEntry } from '../import/store'

/** Synthetic cases only. */

type Row = TrainingRow & { business_type: string | null; import_id: string | null; excluded_reason: string | null; added_at: string }

let n = 0
function row(overrides: Partial<Row> = {}): Row {
  n += 1
  return {
    id: `case-${n}`,
    client_name: `Synthetic ${n}`,
    dpn: n % 3 === 0,
    payment_plan_type: n % 2 === 0 ? 'plan' : 'upfront',
    director_loan_at_appointment: n % 5 === 0,
    director_loan_receivable_amount: 0,
    cumulative_days_late: (n * 137) % 3000,
    number_of_late_lodgements: (n * 7) % 40,
    days_since_last_payment: (n * 53) % 900,
    outcome_percent: 35,
    accepted: n % 4 !== 0,
    creditor_amount: 250_000,
    sbr_payment: 100_000,
    excluded: false,
    business_type: null,
    import_id: null,
    excluded_reason: null,
    added_at: '2026-05-28T00:00:00Z',
    ...overrides,
  }
}

function upload(id: string, uploadedAt: string, undone = false): ImportHistoryEntry {
  return {
    id,
    uploadedAt,
    uploadedBy: 'Sam',
    fileName: `${id}.xlsx`,
    counts: {},
    undoneAt: undone ? '2026-10-20T00:00:00Z' : null,
    undoneBy: undone ? 'Sam' : null,
  }
}

describe('risk bands', () => {
  it('default rule: 0–1 likely accepted, 2 borderline, 3+ high', () => {
    expect(RISK_BAND_RULE).toEqual({ likelyAcceptedMax: 1, borderlineMax: 2 })
    expect([0, 1, 2, 3, 8].map(bandForRejectedNeighbours)).toEqual([
      'likely_accepted',
      'likely_accepted',
      'borderline',
      'high_rejection_risk',
      'high_rejection_risk',
    ])
    expect(describeRiskBandRule()).toBe('0–1 rejected: Likely accepted · 2: Borderline · 3+: High rejection risk')
  })
})

describe('trainingSet', () => {
  it('never uses excluded cases', () => {
    const rows = [row(), row({ excluded: true, excluded_reason: 'data error' }), row()]
    expect(trainingSet(rows).map((c) => c.id)).toEqual([rows[0].id, rows[2].id])
  })
})

describe('leaveOneOut', () => {
  it('needs at least 10 cases', () => {
    expect(leaveOneOut(trainingSet(Array.from({ length: 9 }, () => row())))).toBeNull()
  })

  it('accounts for every case once in the evidence table', () => {
    const cases = trainingSet(Array.from({ length: 30 }, (_, i) => row({ outcome_percent: 30 + (i % 7) * 3 })))
    const result = leaveOneOut(cases)!
    expect(result.sampleSize).toBe(30)
    expect(result.byRejectedNeighbours.reduce((s, r) => s + r.cases, 0)).toBe(30)
    expect(result.byRejectedNeighbours.reduce((s, r) => s + r.actuallyRejected, 0)).toBe(
      cases.filter((c) => !c.accepted).length,
    )
    expect(result.meanAbsoluteError).toBeGreaterThan(0)
    expect(result.rangeCoverage).toBeGreaterThan(0)
    expect(result.rangeCoverage).toBeLessThanOrEqual(1)
  })

  it('is exact when every case has the same outcome', () => {
    const result = leaveOneOut(trainingSet(Array.from({ length: 12 }, () => row({ outcome_percent: 40 }))))!
    expect(result.meanAbsoluteError).toBe(0)
    expect(result.rangeCoverage).toBe(1)
  })
})

describe('shareOf and the data check', () => {
  it('flags a case whose payment and C$ disagree, and keeps it in use', () => {
    // 35 × 250,000 ÷ 100,000 = 87.5%; 20 → 50%; 50 → 125%
    const rows = [row(), row({ outcome_percent: 20 }), row({ outcome_percent: 50 })]
    expect(shareOf(rows[0])).toBeCloseTo(0.875)
    const shown = caseRows(rows, [])
    expect(shown.map((c) => c.dataCheck)).toEqual([false, true, true])
    expect(trainingSet(rows)).toHaveLength(3)
  })

  it('labels the source upload, or the initial data', () => {
    const rows = [row(), row({ import_id: 'u1' })]
    const [initial, imported] = caseRows(rows, [upload('u1', '2026-10-14T01:00:00Z')])
    expect(initial.sourceLabel).toBe('Initial data')
    expect(imported.sourceLabel).toMatch(/^u1\.xlsx · /)
  })
})

describe('growthPoints', () => {
  it('counts the cases in use after the initial data and each upload in force', () => {
    const rows = [
      row({ accepted: true }),
      row({ accepted: false }),
      row({ import_id: 'u1', accepted: true }),
      row({ import_id: 'u1', accepted: true }),
      row({ import_id: 'u2', accepted: false }),
      row({ excluded: true, excluded_reason: 'data error' }),
    ]
    const points = growthPoints(rows, [upload('u2', '2026-10-20T00:00:00Z'), upload('u1', '2026-10-14T00:00:00Z')])
    expect(points.map((p) => [p.label === 'Initial data' ? 'initial' : p.at, p.total, p.accepted, p.rejected])).toEqual([
      ['initial', 2, 1, 1],
      ['2026-10-14T00:00:00Z', 4, 3, 1],
      ['2026-10-20T00:00:00Z', 5, 3, 2],
    ])
  })

  it('has no point for an upload with no cases left (undone)', () => {
    const points = growthPoints([row()], [upload('gone', '2026-10-14T00:00:00Z')])
    expect(points).toHaveLength(1)
  })
})
