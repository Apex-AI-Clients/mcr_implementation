/**
 * The risk-band rule: how many of the k most similar past cases were rejected
 * decides the band. One config, used by the prediction and shown (with its
 * evidence) on the Prediction Data page.
 *
 * Default decided 13 Oct 2026 from leave-one-out on the 83-case dataset:
 * 0–1 rejected neighbours had a 15% actual rejection rate, 2 had 31%, 3 or
 * more had 38%. The bands are indicative, not calibrated probabilities.
 */
import type { SbrRiskBand } from './types'

export const RISK_BAND_RULE = {
  /** Up to this many rejected neighbours: Likely accepted. */
  likelyAcceptedMax: 1,
  /** Up to this many (and above likelyAcceptedMax): Borderline. More: High rejection risk. */
  borderlineMax: 2,
} as const

export const RISK_BAND_LABELS: Record<SbrRiskBand, string> = {
  likely_accepted: 'Likely accepted',
  borderline: 'Borderline',
  high_rejection_risk: 'High rejection risk',
}

export function bandForRejectedNeighbours(rejected: number): SbrRiskBand {
  if (rejected <= RISK_BAND_RULE.likelyAcceptedMax) return 'likely_accepted'
  if (rejected <= RISK_BAND_RULE.borderlineMax) return 'borderline'
  return 'high_rejection_risk'
}

function span(from: number, to: number): string {
  return from === to ? String(from) : `${from}–${to}`
}

/** The rule in one line, e.g. "0–1 rejected: Likely accepted · 2: Borderline · 3+: High rejection risk". */
export function describeRiskBandRule(): string {
  const { likelyAcceptedMax: a, borderlineMax: b } = RISK_BAND_RULE
  const parts = [`${span(0, a)} rejected: ${RISK_BAND_LABELS.likely_accepted}`]
  if (b > a) parts.push(`${span(a + 1, b)}: ${RISK_BAND_LABELS.borderline}`)
  parts.push(`${b + 1}+: ${RISK_BAND_LABELS.high_rejection_risk}`)
  return parts.join(' · ')
}
