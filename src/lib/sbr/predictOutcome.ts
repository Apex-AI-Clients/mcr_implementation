/**
 * Pure, deterministic SBR outcome prediction.
 *
 * No I/O, no AI. Given an input profile + historical training set, returns a
 * k-NN prediction with neighbour list, a human-readable explainer, a 3-tier
 * risk band, and a payment-structure recommendation.
 *
 * Distance metric: Euclidean over z-score-standardised features. Means /
 * stdevs are computed from the supplied training set only (no leakage from
 * the input).
 *
 * v2 (28 May 2026): 7-feature vector (the dl-to-ATO flag dropped), plus the
 * neighbour-rule risk band and accepted-neighbour payment-structure
 * recommendation. See types.ts for the rationale.
 */

import type {
  ComparableCase,
  FeatureBreakdownEntry,
  HistoricalSbrCase,
  ImprovementLever,
  OfferRange,
  PaymentStructureRecommendation,
  RejectionLearning,
  SbrFeatureKey,
  SbrPrediction,
  SbrPredictionInput,
  SbrRiskBand,
} from './types'

const K_NEIGHBOURS = 8
const NUM_FEATURES = 7 // was 8

const FEATURE_LABELS: Record<SbrFeatureKey, string> = {
  dpn: 'Director Penalty Notice',
  paymentPlanType: 'Payment plan type',
  directorLoanAtAppointment: 'Director loan at appointment',
  directorLoanReceivableAmount: 'Director loan receivable amount',
  cumulativeDaysLate: 'Cumulative days late',
  numberOfLateLodgements: 'Number of late lodgements',
  daysSinceLastPayment: 'Days since last payment',
}

/**
 * Known directional correlations between feature and outcome%, decided with
 * Gabby + Tom. Used only to phrase the explainer notes — not in distance.
 *  +1 means "higher feature → higher outcome%"
 *  -1 means "higher feature → lower outcome%"
 *   0 means "no clear direction"
 */
const FEATURE_DIRECTION: Record<SbrFeatureKey, 1 | -1 | 0> = {
  dpn: 1,
  paymentPlanType: -1, // 'plan' (1) softens vs 'upfront' (0) — i.e. higher numeric → lower outcome%
  directorLoanAtAppointment: 0,
  directorLoanReceivableAmount: 1,
  cumulativeDaysLate: 1,
  numberOfLateLodgements: 1,
  daysSinceLastPayment: 1,
}

interface PredictOptions {
  creditorAmount?: number
  mcrFeeRate?: number
}

export function predictSbrOutcome(
  input: SbrPredictionInput,
  trainingSet: HistoricalSbrCase[],
  options?: PredictOptions,
): SbrPrediction {
  if (trainingSet.length === 0) {
    throw new Error('predictSbrOutcome: cannot predict with empty training set')
  }

  const k = Math.min(K_NEIGHBOURS, trainingSet.length)
  const mcrFeeRate = options?.mcrFeeRate ?? 0.1

  const trainMatrix = trainingSet.map((c) => toVector(c.features))

  // Z-score standardisation per feature, computed from the training set only.
  const means: number[] = []
  const stdevs: number[] = []
  for (let j = 0; j < NUM_FEATURES; j++) {
    const col = trainMatrix.map((row) => row[j])
    const m = col.reduce((s, v) => s + v, 0) / col.length
    const variance = col.reduce((s, v) => s + (v - m) ** 2, 0) / col.length
    // Guard divide-by-zero for constant features.
    const sd = Math.sqrt(variance) || 1
    means.push(m)
    stdevs.push(sd)
  }
  const standardise = (vec: number[]) => vec.map((v, j) => (v - means[j]) / stdevs[j])

  const targetVec = standardise(toVector(input))
  const trainStandardised = trainMatrix.map(standardise)

  const distances = trainStandardised.map((row, i) => {
    let sumSq = 0
    for (let j = 0; j < NUM_FEATURES; j++) sumSq += (row[j] - targetVec[j]) ** 2
    return { idx: i, distance: Math.sqrt(sumSq) }
  })
  distances.sort((a, b) => a.distance - b.distance)
  const top = distances.slice(0, k)

  const comparableCases: ComparableCase[] = top.map(({ idx, distance }) => {
    const c = trainingSet[idx]
    return {
      id: c.id,
      clientName: c.clientName,
      outcomePercent: c.outcomePercent,
      accepted: c.accepted,
      creditorAmount: c.creditorAmount,
      sbrPayment: c.sbrPayment,
      features: c.features,
      distance,
      outcomeExplanation: explainHistoricalCaseOutcome(c),
    }
  })

  const neighbourOutcomes = comparableCases.map((c) => c.outcomePercent)
  const predictedOutcomePercent = mean(neighbourOutcomes)
  const predictedLowPercent = Math.min(...neighbourOutcomes)
  const predictedHighPercent = Math.max(...neighbourOutcomes)
  const neighbourStdev = stdev(neighbourOutcomes)

  const featureBreakdown = buildFeatureBreakdown(input, comparableCases)

  const { band, reasoning: riskBandReasoning } = classifyRiskBand(comparableCases)
  const paymentStructureRecommendation = recommendPaymentStructure(comparableCases)
  const rejectedNeighbours = comparableCases.filter((c) => !c.accepted)
  const rejectionLearning = buildRejectionLearning(comparableCases)
  const improvementLevers = buildImprovementLevers(input, comparableCases)

  // NOTE: suggestedOfferAmount = predicted × creditorAmount / (1 - mcrFeeRate).
  // We do NOT add a rejection floor / buffer. Earlier analysis (28 May 2026
  // validation) showed rejected offers in the dataset are NOT systematically
  // lower than accepted offers — Globexo rejected at 61.7%, E&M Kleaning at
  // 59.4%. The "offer more to flip" hypothesis is unsupported by the data.
  const suggestedOfferAmount =
    options?.creditorAmount != null && options.creditorAmount > 0
      ? Math.round(((predictedOutcomePercent / 100) * options.creditorAmount) / (1 - mcrFeeRate))
      : null

  return {
    predictedOutcomePercent: round(predictedOutcomePercent, 1),
    predictedLowPercent: round(predictedLowPercent, 1),
    predictedHighPercent: round(predictedHighPercent, 1),
    comparableCases,
    featureBreakdown,
    suggestedOfferAmount,
    neighbourStdev: round(neighbourStdev, 1),
    trainingSetSize: trainingSet.length,
    riskBand: band,
    riskBandReasoning,
    rejectedNeighbours,
    paymentStructureRecommendation,
    rejectionLearning,
    improvementLevers,
    accuracyDisclosure: {
      meanAbsoluteError: 7.7,
      intervalCoverage: '75%',
      sampleSize: trainingSet.length,
      knownLimitations: [
        `Based on ${trainingSet.length} historical cases (41 accepted, 18 rejected). Predictions are typically within ±8 percentage points of the actual outcome.`,
        '75% of historical actual outcomes fell within the predicted range of the 8 nearest neighbours.',
        'The model does not consider revenue size, ATO debt size, industry, or qualitative factors (ATO assessor variance, documentation quality, contested debts) — these may affect real-world outcomes.',
        'In the historical data, rejected cases were offered amounts between 19.7% and 61.7% — they were not systematically lower than accepted offers. The model therefore does NOT recommend "offer more" to flip a rejection risk; instead it surfaces the risk via the risk band.',
        'Model accuracy improves as more historical cases are logged.',
      ],
      riskBandDisclaimer:
        'Risk band is based on whether similar past cases were rejected. It is a coarse signal, NOT a calibrated probability. Always apply practitioner judgement before quoting any number to a client.',
    },
  }
}

function toVector(f: SbrPredictionInput): number[] {
  return [
    f.dpn ? 1 : 0,
    f.paymentPlanType === 'plan' ? 1 : 0,
    f.directorLoanAtAppointment ? 1 : 0,
    // REMOVED in v2: the director-loan-sent-to-ATO flag
    f.directorLoanReceivableAmount,
    f.cumulativeDaysLate,
    f.numberOfLateLodgements,
    f.daysSinceLastPayment,
  ]
}

/**
 * Produces a plain-English one-sentence explanation of why a historical case
 * received its outcome. Shown in the per-case `ⓘ` tooltip on the comparable
 * case cards. Heuristic — NOT a model output; this is a deterministic
 * rule-based summary so practitioners can audit the reasoning.
 */
function explainHistoricalCaseOutcome(c: HistoricalSbrCase): string {
  const f = c.features
  const reasons: string[] = []
  if (f.cumulativeDaysLate > 5000) reasons.push('very high cumulative days late')
  else if (f.cumulativeDaysLate > 1500) reasons.push('high cumulative days late')
  if (f.numberOfLateLodgements > 20) reasons.push('many late lodgements')
  if (f.daysSinceLastPayment >= 9999) reasons.push('no payments ever recorded')
  else if (f.daysSinceLastPayment > 365) reasons.push('over a year since last payment')
  if (f.dpn) reasons.push('DPN issued')
  if (f.directorLoanAtAppointment) reasons.push('director loan present at appointment')
  if (f.directorLoanReceivableAmount > 100_000) {
    reasons.push(`large director loan ($${Math.round(f.directorLoanReceivableAmount / 1000)}k)`)
  }

  const profile = reasons.length > 0 ? reasons.join(', ') : 'a relatively clean profile'

  if (c.accepted) {
    return `Offered ${c.outcomePercent.toFixed(1)}% and accepted. Profile features: ${profile}.`
  }
  return `Offered ${c.outcomePercent.toFixed(1)}% and rejected. Profile features: ${profile}.`
}

/**
 * Classify the 3-tier risk band from the 8 nearest neighbours.
 *
 * This is intentionally a simple count-based rule, not a ML probability.
 * Validation against the 59-row dataset showed that a Random Forest
 * classifier (without offer as input, to avoid target leakage) only matches
 * baseline accuracy. A rule based on "what fraction of similar past cases
 * were rejected" is more honest given the data and easier for practitioners
 * to interpret.
 */
function classifyRiskBand(comparableCases: ComparableCase[]): {
  band: SbrRiskBand
  reasoning: string
} {
  const k = comparableCases.length
  const rejectedCount = comparableCases.filter((c) => !c.accepted).length
  const acceptedCount = k - rejectedCount

  if (rejectedCount === 0) {
    return {
      band: 'likely_accepted',
      reasoning: `All ${k} closest historical cases were accepted. This profile resembles deals that have gone through.`,
    }
  }

  if (rejectedCount >= 4) {
    return {
      band: 'high_rejection_risk',
      reasoning: `${rejectedCount} of ${k} similar past cases were rejected. This profile resembles deals that have struggled — practitioner judgement strongly advised.`,
    }
  }

  if (rejectedCount <= 2) {
    return {
      band: 'likely_accepted',
      reasoning: `${rejectedCount} of ${k} similar past cases were rejected, ${acceptedCount} were accepted. Profile mostly resembles accepted deals.`,
    }
  }

  // rejectedCount === 3
  return {
    band: 'borderline',
    reasoning: `${rejectedCount} of ${k} similar past cases were rejected, ${acceptedCount} were accepted. Mixed signal — practitioner judgement needed.`,
  }
}

/**
 * Recommend a payment structure from the accepted neighbours only. We learn
 * from what actually worked: among the closest past cases that were accepted,
 * which structure dominated. A 2:1 majority is required to make a call.
 */
function recommendPaymentStructure(
  comparableCases: ComparableCase[],
): PaymentStructureRecommendation {
  const accepted = comparableCases.filter((c) => c.accepted)
  if (accepted.length === 0) {
    return {
      recommended: 'no_strong_signal',
      reasoning: 'No accepted cases among the closest neighbours — cannot recommend a structure.',
      neighbourSplit: { plan: 0, upfront: 0 },
    }
  }
  const plan = accepted.filter((c) => c.features.paymentPlanType === 'plan').length
  const upfront = accepted.filter((c) => c.features.paymentPlanType === 'upfront').length

  if (plan >= upfront * 2) {
    return {
      recommended: 'plan',
      reasoning: `Of ${accepted.length} accepted similar cases, ${plan} used a payment plan vs ${upfront} upfront. Payment plan appears workable for this profile.`,
      neighbourSplit: { plan, upfront },
    }
  }
  if (upfront >= plan * 2) {
    return {
      recommended: 'upfront',
      reasoning: `Of ${accepted.length} accepted similar cases, ${upfront} used upfront payment vs ${plan} payment plan. Upfront is preferred for this profile.`,
      neighbourSplit: { plan, upfront },
    }
  }
  return {
    recommended: 'no_strong_signal',
    reasoning: `Accepted similar cases were split between structures (${plan} plan, ${upfront} upfront). Either structure is workable.`,
    neighbourSplit: { plan, upfront },
  }
}

/**
 * Per-profile "learn from the rejections" analysis (Tom 26 May 2026).
 *
 * Compares the offers (outcome %) of the accepted vs rejected neighbours and
 * gives an HONEST verdict on whether a higher offer would realistically help
 * THIS profile. This is the data-driven answer to "how do we turn a rejection
 * into an acceptance?" — it only says "offer more" when the rejected
 * comparables were genuinely offered LESS than the accepted ones. Where they
 * were not (rejections spread across or above the accepted band), it says a
 * higher offer is unlikely to flip the outcome and points at the non-offer
 * factors that drive SBR rejections. No fabricated approval threshold.
 */
function buildRejectionLearning(cases: ComparableCase[]): RejectionLearning {
  const accepted = cases.filter((c) => c.accepted)
  const rejected = cases.filter((c) => !c.accepted)

  const toRange = (cs: ComparableCase[]): OfferRange | null => {
    if (cs.length === 0) return null
    const offers = cs.map((c) => c.outcomePercent)
    return {
      min: round(Math.min(...offers), 1),
      max: round(Math.max(...offers), 1),
      median: round(median(offers), 1),
      count: cs.length,
    }
  }

  const acceptedOfferRange = toRange(accepted)
  const rejectedOfferRange = toRange(rejected)

  if (rejected.length === 0) {
    return {
      acceptedOfferRange,
      rejectedOfferRange,
      offerMoreVerdict: 'insufficient_signal',
      insight: acceptedOfferRange
        ? `None of the ${cases.length} closest cases were rejected. Comparable deals were accepted between ${acceptedOfferRange.min}% and ${acceptedOfferRange.max}% (median ${acceptedOfferRange.median}%) — a competitive offer for this profile sits in that band.`
        : 'Not enough comparable cases to learn from.',
    }
  }

  if (accepted.length === 0) {
    return {
      acceptedOfferRange,
      rejectedOfferRange,
      offerMoreVerdict: 'higher_offer_unlikely_to_help',
      insight: `All ${cases.length} closest cases were rejected (offers ${rejectedOfferRange!.min}%–${rejectedOfferRange!.max}%). With no accepted comparable, there is no offer level shown to work for this profile — the outcome here is likely driven by factors beyond the offer (eligibility, ATO assessor discretion, documentation, contested debt). Address those before re-offering.`,
    }
  }

  // Both groups present — compare where the rejected offers sat vs accepted.
  if (rejectedOfferRange!.median < acceptedOfferRange!.median) {
    return {
      acceptedOfferRange,
      rejectedOfferRange,
      offerMoreVerdict: 'higher_offer_may_help',
      insight: `Among similar cases, rejected deals were offered LESS (median ${rejectedOfferRange!.median}%) than accepted deals (median ${acceptedOfferRange!.median}%). For this profile a higher offer should help — aim for the accepted band of ${acceptedOfferRange!.min}%–${acceptedOfferRange!.max}% rather than the rejected levels.`,
    }
  }

  return {
    acceptedOfferRange,
    rejectedOfferRange,
    offerMoreVerdict: 'higher_offer_unlikely_to_help',
    insight: `Among similar cases, rejected deals were offered as much or MORE (median ${rejectedOfferRange!.median}%) than accepted deals (median ${acceptedOfferRange!.median}%). A higher offer alone is unlikely to flip this profile — rejections here track factors beyond the offer (eligibility, ATO assessor discretion, documentation, contested debt). Address those before re-offering.`,
  }
}

/**
 * Concrete levers for moving a profile toward the accepted comparables
 * (Gabby/Tom 26 May 2026: "how do we make it accepted?").
 *
 * Compares the client's ACTIONABLE features against the ACCEPTED neighbours
 * only, and surfaces each material gap as a practitioner action. These are
 * associations from comparable accepted deals, NOT guarantees — the UI labels
 * them as such. The offer lever and payment structure are handled separately
 * (rejectionLearning / recommendPaymentStructure) so they are not duplicated
 * here; this focuses on the operational levers a practitioner can pull before
 * lodging: lodgement compliance, payment recency, and the director loan.
 */
function buildImprovementLevers(
  input: SbrPredictionInput,
  cases: ComparableCase[],
): ImprovementLever[] {
  const accepted = cases.filter((c) => c.accepted)
  // Without accepted comparables there is no "accepted profile" to move toward;
  // rejectionLearning already messages that all-rejected situation.
  if (accepted.length === 0) return []

  const levers: ImprovementLever[] = []

  // Lodgement compliance — cumulative days late.
  const accCum = median(accepted.map((c) => c.features.cumulativeDaysLate))
  if (input.cumulativeDaysLate > accCum * 1.25 && input.cumulativeDaysLate - accCum > 100) {
    levers.push({
      factor: 'Lodgement compliance',
      suggestion:
        'Bring overdue activity statements and returns up to date before lodging the SBR proposal.',
      basis: 'The ATO weights lodgement compliance heavily — this is usually the single biggest lever on a borderline profile.',
      current: `${input.cumulativeDaysLate.toLocaleString('en-AU')} cumulative days late`,
      target: `≈${Math.round(accCum).toLocaleString('en-AU')} days (accepted median)`,
      impact: 'high',
    })
  }

  // Late lodgement count.
  const accLate = median(accepted.map((c) => c.features.numberOfLateLodgements))
  if (input.numberOfLateLodgements > accLate * 1.25 && input.numberOfLateLodgements - accLate >= 3) {
    levers.push({
      factor: 'Late lodgements',
      suggestion: 'Clear the backlog of late lodgements where possible before submitting.',
      basis: 'Fewer outstanding lodgements signals a more compliant taxpayer to the ATO assessor.',
      current: `${input.numberOfLateLodgements} late lodgements`,
      target: `≈${Math.round(accLate)} (accepted median)`,
      impact: 'medium',
    })
  }

  // Payment recency.
  const accPay = median(accepted.map((c) => c.features.daysSinceLastPayment))
  if (
    input.daysSinceLastPayment > Math.max(accPay * 1.5, accPay + 90) &&
    input.daysSinceLastPayment > 180
  ) {
    const never = input.daysSinceLastPayment >= 9999
    levers.push({
      factor: 'Payment activity',
      suggestion: never
        ? 'Make a payment to the ATO before submitting — even a partial payment demonstrates good faith.'
        : 'Make a recent payment to demonstrate ongoing good-faith engagement.',
      basis: 'Recent payment activity reads as good-faith engagement and supports the proposal.',
      current: never ? 'No payments on record' : `${input.daysSinceLastPayment} days since last payment`,
      target: `≈${accPay >= 9999 ? 'recent activity' : `${Math.round(accPay)} days`} (accepted median)`,
      impact: 'medium',
    })
  }

  // Director loan at appointment.
  if (input.directorLoanAtAppointment) {
    const withLoan = accepted.filter((c) => c.features.directorLoanAtAppointment).length
    if (withLoan <= accepted.length / 2) {
      levers.push({
        factor: 'Director loan',
        suggestion:
          'Repay or formally address the director loan balance before appointment where feasible.',
        basis: `Most accepted comparables (${accepted.length - withLoan} of ${accepted.length}) had no director loan at appointment; this client does.`,
        current: 'Director loan present',
        target: 'No director loan (most accepted deals)',
        impact: 'high',
      })
    }
  }

  return levers
}

function buildFeatureBreakdown(
  input: SbrPredictionInput,
  neighbours: ComparableCase[],
): FeatureBreakdownEntry[] {
  const keys: SbrFeatureKey[] = [
    'cumulativeDaysLate',
    'numberOfLateLodgements',
    'daysSinceLastPayment',
    'dpn',
    'directorLoanAtAppointment',
    'directorLoanReceivableAmount',
    'paymentPlanType',
  ]

  return keys.map((feature) => {
    if (feature === 'dpn' || feature === 'directorLoanAtAppointment') {
      const inputVal = input[feature]
      const medianBool = booleanMode(neighbours.map((n) => n.features[feature]))
      return {
        feature,
        label: FEATURE_LABELS[feature],
        inputValue: inputVal,
        medianInNeighbours: medianBool,
        influenceNote: phraseBooleanInfluence(feature, inputVal, medianBool),
      }
    }

    if (feature === 'paymentPlanType') {
      const inputVal = input.paymentPlanType
      const medianVal = stringMode(neighbours.map((n) => n.features.paymentPlanType))
      return {
        feature,
        label: FEATURE_LABELS.paymentPlanType,
        inputValue: inputVal,
        medianInNeighbours: medianVal,
        influenceNote: phrasePaymentPlanInfluence(inputVal, medianVal),
      }
    }

    // Numeric features
    const numericKey = feature as
      | 'cumulativeDaysLate'
      | 'numberOfLateLodgements'
      | 'daysSinceLastPayment'
      | 'directorLoanReceivableAmount'
    const inputVal = input[numericKey] as number
    const values = neighbours.map((n) => n.features[numericKey] as number)
    const med = median(values)
    return {
      feature: numericKey,
      label: FEATURE_LABELS[numericKey],
      inputValue: inputVal,
      medianInNeighbours: med,
      influenceNote: phraseNumericInfluence(numericKey, inputVal, med),
    }
  })
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2
  return sorted[mid]
}

function booleanMode(values: boolean[]): boolean {
  const trueCount = values.filter((v) => v).length
  return trueCount > values.length / 2
}

function stringMode<T extends string>(values: T[]): T {
  const counts = new Map<T, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  let best: T = values[0]
  let bestCount = -1
  for (const [key, c] of counts) {
    if (c > bestCount) {
      best = key
      bestCount = c
    }
  }
  return best
}

function phraseBooleanInfluence(
  feature: 'dpn' | 'directorLoanAtAppointment',
  inputVal: boolean,
  median: boolean,
): string {
  if (inputVal === median) {
    if (feature === 'dpn')
      return inputVal
        ? 'Aligned with similar cases (DPN issued).'
        : 'Aligned with similar cases (no DPN).'
    return inputVal
      ? 'Aligned with similar cases (director loan at appointment).'
      : 'Aligned with similar cases (no director loan).'
  }
  // Differs from neighbour majority.
  const direction = FEATURE_DIRECTION[feature]
  if (direction === 0) {
    return inputVal
      ? 'Differs from majority — slight signal toward a higher outcome.'
      : 'Differs from majority — slight signal toward a lower outcome.'
  }
  if (inputVal && direction === 1) return 'Differs from majority — pushes toward a higher outcome.'
  if (!inputVal && direction === 1) return 'Differs from majority — pulls toward a lower outcome.'
  return 'Differs from majority — small influence on the prediction.'
}

function phrasePaymentPlanInfluence(
  inputVal: 'plan' | 'upfront',
  median: 'plan' | 'upfront',
): string {
  if (inputVal === median) {
    return inputVal === 'plan'
      ? 'Aligned with similar cases (payment plan).'
      : 'Aligned with similar cases (upfront payment).'
  }
  // Plan softens outcome%, upfront raises it.
  return inputVal === 'plan'
    ? 'Different from majority (plan instead of upfront) — small softening influence.'
    : 'Different from majority (upfront instead of plan) — small upward influence.'
}

function phraseNumericInfluence(
  feature:
    | 'cumulativeDaysLate'
    | 'numberOfLateLodgements'
    | 'daysSinceLastPayment'
    | 'directorLoanReceivableAmount',
  inputVal: number,
  med: number,
): string {
  const tolerance = Math.max(med * 0.1, 1) // within 10% of median = "aligned"
  const diff = inputVal - med

  if (Math.abs(diff) <= tolerance) {
    return `Aligned with similar cases (${formatNumeric(feature, inputVal)} vs ${formatNumeric(feature, med)} median).`
  }

  const above = diff > 0
  const magnitude = describeMagnitude(inputVal, med)
  const comparison = `${formatNumeric(feature, inputVal)} vs ${formatNumeric(feature, med)} median`

  // Bespoke phrasing per feature.
  if (feature === 'cumulativeDaysLate') {
    return above
      ? `${magnitude} above median (${comparison}) — higher cumulative days late tend to push toward a higher outcome.`
      : `${magnitude} below median (${comparison}) — lower cumulative days late tend to pull toward a lower outcome.`
  }

  if (feature === 'numberOfLateLodgements') {
    return above
      ? `${magnitude} above median (${comparison}) — more late lodgements tend to push toward a higher outcome.`
      : `${magnitude} below median (${comparison}) — fewer late lodgements tend to pull toward a lower outcome.`
  }

  if (feature === 'daysSinceLastPayment') {
    return above
      ? `${magnitude} above median (${comparison}) — payment dormancy tends to push toward a higher outcome.`
      : `${magnitude} below median (${comparison}) — recent payment activity tends to soften the outcome.`
  }

  // directorLoanReceivableAmount
  return above
    ? `${magnitude} above median (${comparison}) — pushes toward a higher outcome.`
    : `${magnitude} below median (${comparison}) — pulls toward a lower outcome.`
}

function formatNumeric(feature: string, value: number): string {
  if (feature === 'directorLoanReceivableAmount') {
    if (value >= 1000) return `$${Math.round(value).toLocaleString('en-AU')}`
    return `$${value.toLocaleString('en-AU')}`
  }
  if (feature === 'daysSinceLastPayment' && value >= 9999) return 'no payments ever'
  return `${Math.round(value).toLocaleString('en-AU')}`
}

function describeMagnitude(inputVal: number, med: number): string {
  if (med === 0) return inputVal > 0 ? 'Substantially' : 'Slightly'
  const ratio = Math.abs(inputVal - med) / Math.max(Math.abs(med), 1)
  if (ratio > 2) return 'Substantially'
  if (ratio > 0.5) return 'Notably'
  return 'Slightly'
}

const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length

const stdev = (xs: number[]) => {
  const m = mean(xs)
  return Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / xs.length)
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}
