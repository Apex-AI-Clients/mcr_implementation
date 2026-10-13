// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { DEFAULT_PRACTITIONER_FEE_RATE, formatFeeRate, isValidFeeRate } from '../fees'
import { clientNames, withoutOwnRecord } from '../historicalCases'
import { isPredictionStale, trainingDataChangedAt } from '../staleness'
import type { HistoricalSbrCase } from '../types'

/** Synthetic names only. */

describe('practitioner fee', () => {
  it('defaults to 12.5% in one place', () => {
    expect(DEFAULT_PRACTITIONER_FEE_RATE).toBe(0.125)
  })

  it.each([
    [0.125, '12.5%'],
    [0.1, '10%'],
    [0.075, '7.5%'],
    [0.05, '5%'],
    [0.0833, '8.33%'],
  ])('%s → %s', (rate, text) => expect(formatFeeRate(rate)).toBe(text))

  it('accepts 0% up to below 50%', () => {
    expect([0, 0.08, 0.499].every(isValidFeeRate)).toBe(true)
    expect([-0.01, 0.5, Number.NaN, '0.1'].some(isValidFeeRate)).toBe(false)
  })
})

describe('staleness', () => {
  const imports = [
    { uploaded_at: '2026-10-14T00:00:00Z', undone_at: null, counts: { added: 24, corrected: 3 } },
    // Details only: the prediction's inputs did not change.
    { uploaded_at: '2026-10-20T00:00:00Z', undone_at: null, counts: { added: 0, corrected: 0, details_added: 5 } },
    // Undone later: the undo changed the data too.
    { uploaded_at: '2026-10-15T00:00:00Z', undone_at: '2026-10-18T00:00:00Z', counts: { added: 2, corrected: 0 } },
  ]

  it('is the latest upload or undo that changed cases', () => {
    expect(trainingDataChangedAt(imports)).toBe('2026-10-18T00:00:00Z')
    expect(trainingDataChangedAt([])).toBeNull()
  })

  it('marks a prediction made before that as stale', () => {
    const changed = trainingDataChangedAt(imports)
    expect(isPredictionStale('2026-10-17T00:00:00Z', changed)).toBe(true)
    expect(isPredictionStale('2026-10-19T00:00:00Z', changed)).toBe(false)
    expect(isPredictionStale('2026-01-01T00:00:00Z', null)).toBe(false)
  })
})

describe('never matching a client with its own record', () => {
  const kase = (id: string, clientName: string): HistoricalSbrCase => ({
    id,
    clientName,
    features: {
      dpn: false,
      paymentPlanType: 'plan',
      directorLoanAtAppointment: false,
      directorLoanReceivableAmount: 0,
      cumulativeDaysLate: 100,
      numberOfLateLodgements: 2,
      daysSinceLastPayment: 30,
    },
    outcomePercent: 40,
    accepted: true,
    creditorAmount: 250_000,
    sbrPayment: 110_000,
  })

  const cases = [kase('a', 'EXAMPLE CONSTRUCTIONS PTY LTD'), kase('b', 'Example Trust'), kase('c', 'Other Co Pty Ltd')]

  it("leaves out a case under the client's, company's or trust's name, however it is written", () => {
    const names = clientNames({
      name: 'Example Constructions',
      company_details: { company_name: 'Example Constructions Pty Limited', trust_name: 'The Example Trust' },
    })
    expect(withoutOwnRecord(cases, names).map((c) => c.id)).toEqual(['c'])
  })

  it('keeps everything when no name matches, and ignores blank names', () => {
    const names = clientNames({ name: 'Unrelated', company_details: [{ company_name: '', trust_name: null }] })
    expect(withoutOwnRecord(cases, names)).toHaveLength(3)
  })

  it('only drops exact name matches, not names that merely contain it', () => {
    expect(withoutOwnRecord([kase('x', 'Example Constructions North Pty Ltd')], ['Example Constructions'])).toHaveLength(1)
  })
})
