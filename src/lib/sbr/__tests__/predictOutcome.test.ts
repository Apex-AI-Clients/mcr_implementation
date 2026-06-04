import { describe, it, expect } from 'vitest'
import { predictSbrOutcome } from '../predictOutcome'
import type { HistoricalSbrCase, SbrPredictionInput } from '../types'

const sampleInput: SbrPredictionInput = {
  dpn: false,
  paymentPlanType: 'plan',
  directorLoanAtAppointment: false,
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

/**
 * Synthetic training-set builder for the v2 risk-band and payment-structure
 * tests. All cases share sampleInput's numeric features (so they're all in
 * the k=8 neighbourhood), and the builder exposes knobs to control the
 * accepted/rejected mix, the plan/upfront split, and the outcome spread.
 */
function buildSyntheticTrainingSet(
  opts: {
    rejectedCount?: number
    acceptedPlan?: number
    acceptedUpfront?: number
    withRejectionsAt?: number
    predictedNear?: number
    acceptedOutcome?: number
    rejectedOutcome?: number
    acceptedCount?: number
  } = {},
): HistoricalSbrCase[] {
  const cases: HistoricalSbrCase[] = []
  let i = 0
  const add = (outcome: number, accepted: boolean, plan: boolean) => {
    cases.push(
      makeCase(
        `syn-${i}`,
        `Synthetic ${i}`,
        { ...sampleInput, paymentPlanType: plan ? 'plan' : 'upfront' },
        outcome,
        { accepted },
      ),
    )
    i++
  }

  // Mode: control the accepted vs rejected offer levels (for rejectionLearning).
  if (opts.acceptedOutcome != null && opts.rejectedOutcome != null) {
    const ac = opts.acceptedCount ?? 4
    const rc = opts.rejectedCount ?? 4
    for (let n = 0; n < ac; n++) add(opts.acceptedOutcome, true, true)
    for (let n = 0; n < rc; n++) add(opts.rejectedOutcome, false, false)
    return cases
  }

  // Mode: control the rejected-outcome level and the resulting mean prediction.
  if (opts.withRejectionsAt != null && opts.predictedNear != null) {
    const rej = opts.withRejectionsAt
    const acceptedOutcome = (8 * opts.predictedNear - 2 * rej) / 6
    add(rej, false, false)
    add(rej, false, false)
    for (let n = 0; n < 6; n++) add(acceptedOutcome, true, true)
    return cases
  }

  // Mode: control the plan/upfront split among accepted neighbours.
  if (opts.acceptedPlan != null || opts.acceptedUpfront != null) {
    const plan = opts.acceptedPlan ?? 0
    const upfront = opts.acceptedUpfront ?? 0
    for (let n = 0; n < plan; n++) add(40, true, true)
    for (let n = 0; n < upfront; n++) add(40, true, false)
    return cases
  }

  // Default mode: control how many of the 8 neighbours were rejected.
  const rejectedCount = opts.rejectedCount ?? 0
  for (let n = 0; n < rejectedCount; n++) add(40, false, false)
  for (let n = 0; n < 8 - rejectedCount; n++) add(40, true, true)
  return cases
}

const syntheticTrainingSet = buildSyntheticTrainingSet({ rejectedCount: 2 })

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
      sbrPractitionerFeeRate: 0.125,
    })
    // 40% of 200k = 80k. Offer = 80k / (1 - 0.125) = 91,428.57 → rounded to 91,429.
    expect(result.suggestedOfferAmount).toBe(91429)
  })

  it('returns null suggestedOfferAmount when creditorAmount is not provided', () => {
    const only = makeCase('case-1', 'Only Co', sampleInput, 40)
    const result = predictSbrOutcome(sampleInput, [only])
    expect(result.suggestedOfferAmount).toBeNull()
  })

  it('always populates the accuracy disclosure', () => {
    const only = makeCase('case-1', 'Only Co', sampleInput, 40)
    const result = predictSbrOutcome(sampleInput, [only])
    expect(result.accuracyDisclosure.meanAbsoluteError).toBe(7.7)
    expect(result.accuracyDisclosure.intervalCoverage).toBe('75%')
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

  it('emits a feature breakdown entry for each of the 7 features with plain-English notes', () => {
    const trainingSet: HistoricalSbrCase[] = Array.from({ length: 10 }, (_, i) =>
      makeCase(`c-${i}`, `Co ${i}`, sampleInput, 38 + i * 0.5),
    )
    const result = predictSbrOutcome(sampleInput, trainingSet)
    expect(result.featureBreakdown).toHaveLength(7)
    for (const entry of result.featureBreakdown) {
      expect(entry.label.length).toBeGreaterThan(0)
      expect(entry.influenceNote.length).toBeGreaterThan(0)
      // No jargon allowed.
      expect(entry.influenceNote).not.toMatch(/z-?score|euclidean|k-?nn/i)
    }
  })
})

describe('v2 — risk banding and payment-structure recommendation', () => {
  it('riskBand=likely_accepted when 0-2 of 8 neighbours rejected', () => {
    const ts = buildSyntheticTrainingSet({ rejectedCount: 1 })
    const r = predictSbrOutcome(sampleInput, ts)
    expect(r.riskBand).toBe('likely_accepted')
  })

  it('riskBand=borderline when 3 of 8 neighbours rejected', () => {
    const ts = buildSyntheticTrainingSet({ rejectedCount: 3 })
    const r = predictSbrOutcome(sampleInput, ts)
    expect(r.riskBand).toBe('borderline')
  })

  it('riskBand=high_rejection_risk when 4+ of 8 neighbours rejected', () => {
    const ts = buildSyntheticTrainingSet({ rejectedCount: 5 })
    const r = predictSbrOutcome(sampleInput, ts)
    expect(r.riskBand).toBe('high_rejection_risk')
  })

  it('paymentStructureRecommendation respects 2:1 majority threshold', () => {
    const ts = buildSyntheticTrainingSet({ acceptedPlan: 6, acceptedUpfront: 2 })
    const r = predictSbrOutcome(sampleInput, ts)
    expect(r.paymentStructureRecommendation.recommended).toBe('plan')
  })

  it('paymentStructureRecommendation=no_strong_signal when split close to even', () => {
    const ts = buildSyntheticTrainingSet({ acceptedPlan: 4, acceptedUpfront: 4 })
    const r = predictSbrOutcome(sampleInput, ts)
    expect(r.paymentStructureRecommendation.recommended).toBe('no_strong_signal')
  })

  it('every comparable case has outcomeExplanation populated', () => {
    const r = predictSbrOutcome(sampleInput, syntheticTrainingSet)
    for (const c of r.comparableCases) {
      expect(c.outcomeExplanation.length).toBeGreaterThan(20)
      expect(c.outcomeExplanation).toMatch(/(accepted|rejected)/i)
    }
  })

  it('feature vector is 7-dimensional (dl_ato removed)', () => {
    // Compile-time: SbrPredictionInput must not allow the dropped dl-to-ATO flag.
    const input: SbrPredictionInput = {
      dpn: false,
      paymentPlanType: 'upfront',
      directorLoanAtAppointment: false,
      directorLoanReceivableAmount: 0,
      cumulativeDaysLate: 100,
      numberOfLateLodgements: 1,
      daysSinceLastPayment: 30,
    }
    expect(() => predictSbrOutcome(input, syntheticTrainingSet)).not.toThrow()
  })

  it('accuracyDisclosure exposes the updated MAE and coverage', () => {
    const r = predictSbrOutcome(sampleInput, syntheticTrainingSet)
    expect(r.accuracyDisclosure.meanAbsoluteError).toBe(7.7)
    expect(r.accuracyDisclosure.intervalCoverage).toBe('75%')
    expect(r.accuracyDisclosure.knownLimitations.some((s) => s.includes('19.7%'))).toBe(true)
  })

  it('rejectionLearning verdict=higher_offer_may_help when rejected offers were lower', () => {
    const ts = buildSyntheticTrainingSet({ acceptedOutcome: 40, rejectedOutcome: 25 })
    const r = predictSbrOutcome(sampleInput, ts)
    expect(r.rejectionLearning.offerMoreVerdict).toBe('higher_offer_may_help')
    expect(r.rejectionLearning.acceptedOfferRange?.median).toBe(40)
    expect(r.rejectionLearning.rejectedOfferRange?.median).toBe(25)
  })

  it('rejectionLearning verdict=higher_offer_unlikely_to_help when rejected offers were higher', () => {
    const ts = buildSyntheticTrainingSet({ acceptedOutcome: 40, rejectedOutcome: 55 })
    const r = predictSbrOutcome(sampleInput, ts)
    expect(r.rejectionLearning.offerMoreVerdict).toBe('higher_offer_unlikely_to_help')
    expect(r.rejectionLearning.insight).toMatch(/beyond the offer|as much or MORE/i)
  })

  it('rejectionLearning gives the accepted band when no neighbours were rejected', () => {
    const ts = buildSyntheticTrainingSet({ rejectedCount: 0 })
    const r = predictSbrOutcome(sampleInput, ts)
    expect(r.rejectionLearning.offerMoreVerdict).toBe('insufficient_signal')
    expect(r.rejectionLearning.rejectedOfferRange).toBeNull()
    expect(r.rejectionLearning.acceptedOfferRange).not.toBeNull()
  })

  it('improvementLevers surfaces lodgement compliance when worse than accepted comparables', () => {
    const ts: HistoricalSbrCase[] = Array.from({ length: 8 }, (_, i) =>
      makeCase(
        `clean-${i}`,
        `Clean ${i}`,
        { ...sampleInput, cumulativeDaysLate: 50, numberOfLateLodgements: 2 },
        38,
        { accepted: true },
      ),
    )
    const query: SbrPredictionInput = {
      ...sampleInput,
      cumulativeDaysLate: 5000,
      numberOfLateLodgements: 30,
    }
    const r = predictSbrOutcome(query, ts)
    expect(r.improvementLevers.some((l) => /lodgement/i.test(l.factor))).toBe(true)
    expect(r.improvementLevers.some((l) => /late lodgement/i.test(l.factor))).toBe(true)
  })

  it('improvementLevers is empty when the client already matches accepted comparables', () => {
    const ts = buildSyntheticTrainingSet({ rejectedCount: 0 }) // all accepted, features = sampleInput
    const r = predictSbrOutcome(sampleInput, ts)
    expect(r.improvementLevers).toHaveLength(0)
  })

  it('acceptedAlignedOffer = raise with a higher target when accepted deals offered more', () => {
    const ts = buildSyntheticTrainingSet({ acceptedOutcome: 40, rejectedOutcome: 25 })
    const r = predictSbrOutcome(sampleInput, ts, { creditorAmount: 200_000 })
    expect(r.acceptedAlignedOffer.mode).toBe('raise')
    expect(r.acceptedAlignedOffer.targetPercent).toBe(40)
    expect(r.acceptedAlignedOffer.targetAmount!).toBeGreaterThan(r.suggestedOfferAmount!)
  })

  it('acceptedAlignedOffer = already_strong when the current offer already tops accepted deals', () => {
    // Accepted at 40, rejected at 55 → predicted mean (47.5%) exceeds the
    // accepted ceiling (40%), so raising the offer is not the lever.
    const ts = buildSyntheticTrainingSet({ acceptedOutcome: 40, rejectedOutcome: 55 })
    const r = predictSbrOutcome(sampleInput, ts, { creditorAmount: 200_000 })
    expect(r.acceptedAlignedOffer.mode).toBe('already_strong')
  })

  it('acceptedAlignedOffer = no_data without a creditor amount', () => {
    const ts = buildSyntheticTrainingSet({ acceptedOutcome: 40, rejectedOutcome: 25 })
    const r = predictSbrOutcome(sampleInput, ts)
    expect(r.acceptedAlignedOffer.mode).toBe('no_data')
    expect(r.acceptedAlignedOffer.targetAmount).toBeNull()
  })

  it('suggestedOfferAmount uses raw predicted outcome (no rejection floor)', () => {
    // Construct a training set where rejections in neighbours are at 50%
    // and the predicted outcome is 35%. v2 must NOT lift the offer to 50%+.
    const ts = buildSyntheticTrainingSet({ withRejectionsAt: 50, predictedNear: 35 })
    const r = predictSbrOutcome(sampleInput, ts, { creditorAmount: 200_000 })
    // Predicted should be ~35; suggestedOfferAmount should reflect 35, not 50+
    expect(r.predictedOutcomePercent).toBeLessThan(45)
    if (r.suggestedOfferAmount !== null) {
      expect(r.suggestedOfferAmount).toBeLessThan(120_000) // 50% × 200k / 0.9 ≈ 111k+
    }
  })
})
