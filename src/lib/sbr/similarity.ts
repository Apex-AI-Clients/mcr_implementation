/**
 * How similar two SBR profiles are: the distance the prediction ranks past
 * cases by. Pure, no I/O, safe in the browser — the Prediction Data page's
 * chart draws a case's 8 nearest with exactly this, so what staff see on
 * hover is what a prediction would use.
 *
 * Euclidean distance over the 7 features, each z-score standardised on the
 * training set only (no leakage from the input). Days since last payment is
 * capped, for the distance only, at the longest real gap in the training set,
 * so "no payments ever" (9999) sits at that cap instead of dwarfing every
 * other value.
 */
import { NO_PAYMENTS_EVER_DAYS } from './import/config'
import type { HistoricalSbrCase, SbrPredictionInput } from './types'

export const NUM_FEATURES = 7

/**
 * The longest real gap since a last payment in the training set: the value
 * "no payments ever" stands for when measuring similarity. Null when the set
 * has no real figure.
 */
export function daysSinceLastPaymentCap(trainingSet: readonly HistoricalSbrCase[]): number | null {
  const real = trainingSet
    .map((c) => c.features.daysSinceLastPayment)
    .filter((d) => d < NO_PAYMENTS_EVER_DAYS)
  return real.length > 0 ? Math.max(...real) : null
}

function toVector(f: SbrPredictionInput, daysCap: number | null): number[] {
  return [
    f.dpn ? 1 : 0,
    f.paymentPlanType === 'plan' ? 1 : 0,
    f.directorLoanAtAppointment ? 1 : 0,
    // REMOVED in v2: the director-loan-sent-to-ATO flag
    f.directorLoanReceivableAmount,
    f.cumulativeDaysLate,
    f.numberOfLateLodgements,
    daysCap === null ? f.daysSinceLastPayment : Math.min(f.daysSinceLastPayment, daysCap),
  ]
}

export interface Ranked {
  /** Index into the training set. */
  idx: number
  distance: number
}

/** Every training case ranked by distance from `input`, nearest first. */
export function rankBySimilarity(
  input: SbrPredictionInput,
  trainingSet: readonly HistoricalSbrCase[],
): { ranked: Ranked[]; daysCap: number | null } {
  const daysCap = daysSinceLastPaymentCap(trainingSet)
  const trainMatrix = trainingSet.map((c) => toVector(c.features, daysCap))

  // Z-score standardisation per feature, computed from the training set only.
  const means: number[] = []
  const stdevs: number[] = []
  for (let j = 0; j < NUM_FEATURES; j++) {
    const col = trainMatrix.map((row) => row[j])
    const m = col.reduce((s, v) => s + v, 0) / col.length
    const variance = col.reduce((s, v) => s + (v - m) ** 2, 0) / col.length
    // Guard divide-by-zero for constant features.
    stdevs.push(Math.sqrt(variance) || 1)
    means.push(m)
  }
  const standardise = (vec: number[]) => vec.map((v, j) => (v - means[j]) / stdevs[j])

  const target = standardise(toVector(input, daysCap))
  const ranked = trainMatrix.map(standardise).map((row, idx) => {
    let sumSq = 0
    for (let j = 0; j < NUM_FEATURES; j++) sumSq += (row[j] - target[j]) ** 2
    return { idx, distance: Math.sqrt(sumSq) }
  })
  ranked.sort((a, b) => a.distance - b.distance)
  return { ranked, daysCap }
}

/**
 * The ids of the k cases most similar to one of the cases, leaving that case
 * out — the comparison leave-one-out makes, and the one the chart draws.
 */
export function nearestCaseIds(
  caseId: string,
  cases: readonly HistoricalSbrCase[],
  k = 8,
): string[] {
  const target = cases.find((c) => c.id === caseId)
  if (!target) return []
  const others = cases.filter((c) => c.id !== caseId)
  if (others.length === 0) return []
  return rankBySimilarity(target.features, others)
    .ranked.slice(0, k)
    .map((r) => others[r.idx].id)
}
