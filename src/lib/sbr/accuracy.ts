/**
 * How well the prediction does on the data it has: leave-one-out. Each case is
 * predicted from all the others and compared with what actually happened.
 * Pure; recomputed from the current cases whenever the page renders, so it
 * moves with every import and undo.
 */
import { predictSbrOutcome } from './predictOutcome'
import type { HistoricalSbrCase } from './types'

export interface RejectedNeighboursRow {
  /** How many of the k nearest past cases were rejected. */
  rejectedNeighbours: number
  /** Cases whose nearest neighbours had that many rejections. */
  cases: number
  /** Of those, how many were actually rejected. */
  actuallyRejected: number
}

export interface LeaveOneOutResult {
  sampleSize: number
  /** Mean absolute error of the predicted outcome %, in percentage points. */
  meanAbsoluteError: number
  /** Share of cases whose actual outcome fell inside the neighbours' range. */
  rangeCoverage: number
  /** The evidence behind the risk bands, by number of rejected neighbours. */
  byRejectedNeighbours: RejectedNeighboursRow[]
}

/** Below this many cases a leave-one-out figure says nothing useful. */
export const MIN_CASES_FOR_ACCURACY = 10

export function leaveOneOut(cases: readonly HistoricalSbrCase[]): LeaveOneOutResult | null {
  if (cases.length < MIN_CASES_FOR_ACCURACY) return null

  let absoluteError = 0
  let covered = 0
  const buckets = new Map<number, RejectedNeighboursRow>()

  cases.forEach((held, i) => {
    const others = cases.filter((_, j) => j !== i)
    const p = predictSbrOutcome(held.features, others)
    absoluteError += Math.abs(p.predictedOutcomePercent - held.outcomePercent)
    if (held.outcomePercent >= p.predictedLowPercent && held.outcomePercent <= p.predictedHighPercent) {
      covered += 1
    }
    const rejected = p.rejectedNeighbours.length
    const row = buckets.get(rejected) ?? { rejectedNeighbours: rejected, cases: 0, actuallyRejected: 0 }
    row.cases += 1
    if (!held.accepted) row.actuallyRejected += 1
    buckets.set(rejected, row)
  })

  return {
    sampleSize: cases.length,
    meanAbsoluteError: Math.round((absoluteError / cases.length) * 10) / 10,
    rangeCoverage: covered / cases.length,
    byRejectedNeighbours: [...buckets.values()].sort((a, b) => a.rejectedNeighbours - b.rejectedNeighbours),
  }
}
