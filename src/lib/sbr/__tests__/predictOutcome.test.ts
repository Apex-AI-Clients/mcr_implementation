import { describe, it, expect } from 'vitest'
import { predictSbrOutcome } from '../predictOutcome'
import type { HistoricalSbrCase, SbrPredictionInput } from '../types'

const sampleInput: SbrPredictionInput = {
  dpn: false,
  paymentPlanType: 'plan',
  directorLoanAtAppointment: false,
  directorLoanSentToAto: false,
  directorLoanReceivableAmount: 0,
  cumulativeDaysLate: 500,
  numberOfLateLodgements: 10,
  daysSinceLastPayment: 60,
}

function makeCase(
  id: string,
  name: string,
  features: SbrPredictionInput,
  outcomePercent: number,
  opts?: { accepted?: boolean; creditorAmount?: number; sbrPayment?: number },
): HistoricalSbrCase {
  return {
    id,
    clientName: name,
    features,
    outcomePercent,
    accepted: opts?.accepted ?? true,
    creditorAmount: opts?.creditorAmount ?? 250_000,
    sbrPayment: opts?.sbrPayment ?? 100_000,
  }
}

describe('predictSbrOutcome', () => {
  it('throws on an empty training set', () => {
    expect(() => predictSbrOutcome(sampleInput, [])).toThrow(/empty training set/)
  })

  it('returns an exact-match neighbour at distance 0 when querying its own features', () => {
    const only = makeCase('case-1', 'Only Co', sampleInput, 42.7)
    const result = predictSbrOutcome(sampleInput, [only])

    expect(result.predictedOutcomePercent).toBe(42.7)
    expect(result.predictedLowPercent).toBe(42.7)
    expect(result.predictedHighPercent).toBe(42.7)
    expect(result.comparableCases).toHaveLength(1)
    expect(result.comparableCases[0].id).toBe('case-1')
    expect(result.comparableCases[0].distance).toBeCloseTo(0, 10)
  })

  it('picks the closest neighbours by standardised distance', () => {
    // Build 10 cases spanning a known spread; query something close to "near".
    const trainingSet: HistoricalSbrCase[] = [
      makeCase('a', 'Alpha Pty Ltd', { ...sampleInput, cumulativeDaysLate: 60, numberOfLateLodgements: 3, daysSinceLastPayment: 30 }, 35.0),
      makeCase('b', 'Bravo Pty Ltd', { ...sampleInput, cumulativeDaysLate: 100, numberOfLateLodgements: 5, daysSinceLastPayment: 45 }, 36.5),
      makeCase('c', 'Charlie Pty Ltd', { ...sampleInput, cumulativeDaysLate: 150, numberOfLateLodgements: 6, daysSinceLastPayment: 50 }, 37.0),
      makeCase('d', 'Delta Pty Ltd', { ...sampleInput, cumulativeDaysLate: 250, numberOfLateLodgements: 8, daysSinceLastPayment: 55 }, 38.5),
      makeCase('e', 'Echo Pty Ltd', { ...sampleInput, cumulativeDaysLate: 500, numberOfLateLodgements: 12, daysSinceLastPayment: 65 }, 41.0),
      makeCase('f', 'Foxtrot Pty Ltd', { ...sampleInput, cumulativeDaysLate: 1200, numberOfLateLodgements: 18, daysSinceLastPayment: 80 }, 45.0),
      makeCase('g', 'Golf Pty Ltd', { ...sampleInput, cumulativeDaysLate: 2500, numberOfLateLodgements: 22, daysSinceLastPayment: 90 }, 48.0),
      makeCase('h', 'Hotel Pty Ltd', { ...sampleInput, cumulativeDaysLate: 4000, numberOfLateLodgements: 26, daysSinceLastPayment: 120 }, 52.0),
      makeCase('i', 'India Pty Ltd', { ...sampleInput, cumulativeDaysLate: 8000, numberOfLateLodgements: 35, daysSinceLastPayment: 200 }, 57.0),
      makeCase('j', 'Juliet Pty Ltd', { ...sampleInput, cumulativeDaysLate: 12000, numberOfLateLodgements: 60, daysSinceLastPayment: 800 }, 62.0),
    ]
    const query: SbrPredictionInput = {
      ...sampleInput,
      cumulativeDaysLate: 300,
      numberOfLateLodgements: 9,
      daysSinceLastPayment: 55,
    }
    const result = predictSbrOutcome(query, trainingSet)
    expect(result.comparableCases).toHaveLength(8) // k = 8
    const closestIds = result.comparableCases.slice(0, 5).map((c) => c.id)
    // The 5 closest must all sit in the low-to-mid range, not the extreme tail.
    expect(closestIds).toEqual(expect.arrayContaining(['c', 'd', 'e']))
    expect(closestIds).not.toContain('j')
    // Prediction sits in the band of the closest neighbours' outcomes.
    expect(result.predictedOutcomePercent).toBeGreaterThan(35)
    expect(result.predictedOutcomePercent).toBeLessThan(50)
  })

  it('back-calculates the suggested offer from predicted outcome and creditor amount', () => {
    const only = makeCase('case-1', 'Only Co', sampleInput, 40)
    const result = predictSbrOutcome(sampleInput, [only], {
      creditorAmount: 200_000,
      mcrFeeRate: 0.1,
    })
    // 40% of 200k = 80k. Offer = 80k / (1 - 0.1) = 88,888.89 → rounded to 88,889.
    expect(result.suggestedOfferAmount).toBe(88889)
  })

  it('returns null suggestedOfferAmount when creditorAmount is not provided', () => {
    const only = makeCase('case-1', 'Only Co', sampleInput, 40)
    const result = predictSbrOutcome(sampleInput, [only])
    expect(result.suggestedOfferAmount).toBeNull()
  })

  it('always populates the accuracy disclosure', () => {
    const only = makeCase('case-1', 'Only Co', sampleInput, 40)
    const result = predictSbrOutcome(sampleInput, [only])
    expect(result.accuracyDisclosure.meanAbsoluteError).toBe(6.1)
    expect(result.accuracyDisclosure.intervalCoverage).toBe('76%')
    expect(result.accuracyDisclosure.sampleSize).toBe(1)
    expect(result.accuracyDisclosure.knownLimitations.length).toBeGreaterThan(0)
  })

  it('uses fewer than k neighbours when the training set is small', () => {
    const trainingSet: HistoricalSbrCase[] = [
      makeCase('a', 'Alpha', sampleInput, 30),
      makeCase('b', 'Bravo', sampleInput, 40),
      makeCase('c', 'Charlie', sampleInput, 50),
    ]
    const result = predictSbrOutcome(sampleInput, trainingSet)
    expect(result.comparableCases).toHaveLength(3)
    expect(result.predictedOutcomePercent).toBeCloseTo(40, 6)
    expect(result.predictedLowPercent).toBe(30)
    expect(result.predictedHighPercent).toBe(50)
  })

  it('emits a feature breakdown entry for each of the 8 features with plain-English notes', () => {
    const trainingSet: HistoricalSbrCase[] = Array.from({ length: 10 }, (_, i) =>
      makeCase(`c-${i}`, `Co ${i}`, sampleInput, 38 + i * 0.5),
    )
    const result = predictSbrOutcome(sampleInput, trainingSet)
    expect(result.featureBreakdown).toHaveLength(8)
    for (const entry of result.featureBreakdown) {
      expect(entry.label.length).toBeGreaterThan(0)
      expect(entry.influenceNote.length).toBeGreaterThan(0)
      // No jargon allowed.
      expect(entry.influenceNote).not.toMatch(/z-?score|euclidean|k-?nn/i)
    }
  })
})
