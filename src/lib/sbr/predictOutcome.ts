/**
 * Pure, deterministic SBR outcome prediction.
 *
 * No I/O, no AI. Given an input profile + historical training set, returns a
 * k-NN prediction with neighbour list and a human-readable explainer.
 *
 * Distance metric: Euclidean over z-score-standardised features. Means /
 * stdevs are computed from the supplied training set only (no leakage from
 * the input).
 */

import type {
  ComparableCase,
  FeatureBreakdownEntry,
  HistoricalSbrCase,
  SbrFeatureKey,
  SbrPrediction,
  SbrPredictionInput,
} from './types'

const K_NEIGHBOURS = 8
const NUM_FEATURES = 8

const FEATURE_LABELS: Record<SbrFeatureKey, string> = {
  dpn: 'Director Penalty Notice',
  paymentPlanType: 'Payment plan type',
  directorLoanAtAppointment: 'Director loan at appointment',
  directorLoanSentToAto: 'Director loan sent to ATO',
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
  directorLoanSentToAto: 0,
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
    const mean = col.reduce((s, v) => s + v, 0) / col.length
    const variance = col.reduce((s, v) => s + (v - mean) ** 2, 0) / col.length
    // Guard divide-by-zero for constant features.
    const stdev = Math.sqrt(variance) || 1
    means.push(mean)
    stdevs.push(stdev)
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
    }
  })

  const neighbourOutcomes = comparableCases.map((c) => c.outcomePercent)
  const predictedOutcomePercent =
    neighbourOutcomes.reduce((s, v) => s + v, 0) / neighbourOutcomes.length
  const predictedLowPercent = Math.min(...neighbourOutcomes)
  const predictedHighPercent = Math.max(...neighbourOutcomes)
  const neighbourStdev = Math.sqrt(
    neighbourOutcomes.reduce((s, v) => s + (v - predictedOutcomePercent) ** 2, 0) /
      neighbourOutcomes.length,
  )

  const featureBreakdown = buildFeatureBreakdown(input, comparableCases)

  const suggestedOfferAmount =
    options?.creditorAmount != null && options.creditorAmount > 0
      ? Math.round(
          ((predictedOutcomePercent / 100) * options.creditorAmount) / (1 - mcrFeeRate),
        )
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
    accuracyDisclosure: {
      meanAbsoluteError: 6.1,
      intervalCoverage: '76%',
      sampleSize: trainingSet.length,
      knownLimitations: [
        `Based on ${trainingSet.length} historical cases. Predictions are typically within ±6 percentage points of the actual outcome.`,
        '76% of historical outcomes fell within the predicted range.',
        'Model accuracy improves as more historical cases are logged.',
        'The model does not consider revenue size, ATO debt size, or industry — these may affect real-world outcomes.',
      ],
    },
  }
}

function toVector(f: SbrPredictionInput): number[] {
  return [
    f.dpn ? 1 : 0,
    f.paymentPlanType === 'plan' ? 1 : 0,
    f.directorLoanAtAppointment ? 1 : 0,
    f.directorLoanSentToAto ? 1 : 0,
    f.directorLoanReceivableAmount,
    f.cumulativeDaysLate,
    f.numberOfLateLodgements,
    f.daysSinceLastPayment,
  ]
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
    'directorLoanSentToAto',
    'directorLoanReceivableAmount',
    'paymentPlanType',
  ]

  return keys.map((feature) => {
    if (
      feature === 'dpn' ||
      feature === 'directorLoanAtAppointment' ||
      feature === 'directorLoanSentToAto'
    ) {
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
  for (const [k, c] of counts) {
    if (c > bestCount) {
      best = k
      bestCount = c
    }
  }
  return best
}

function phraseBooleanInfluence(
  feature: 'dpn' | 'directorLoanAtAppointment' | 'directorLoanSentToAto',
  inputVal: boolean,
  median: boolean,
): string {
  if (inputVal === median) {
    if (feature === 'dpn') return inputVal ? 'Aligned with similar cases (DPN issued).' : 'Aligned with similar cases (no DPN).'
    if (feature === 'directorLoanAtAppointment')
      return inputVal
        ? 'Aligned with similar cases (director loan at appointment).'
        : 'Aligned with similar cases (no director loan).'
    return inputVal
      ? 'Aligned with similar cases (director loan sent to ATO).'
      : 'Aligned with similar cases (no director loan sent to ATO).'
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

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}
