/**
 * The SBR practitioner fee: the share of the gross offer the practitioner
 * keeps, so creditors receive the rest. One default for the whole app; staff
 * can choose another per client on the prediction page, and it is saved with
 * that client's prediction (sbr_outcome_predictions.practitioner_fee_rate).
 *
 * Migration 0028 sets the same 0.125 as the column default.
 */
export const DEFAULT_PRACTITIONER_FEE_RATE = 0.125

/** The quick choices on the prediction page; anything else is "custom". */
export const PRACTITIONER_FEE_OPTIONS = [0.125, 0.1, 0.075, 0.05] as const

/** A custom fee must be at least 0% and below this. */
export const MAX_PRACTITIONER_FEE_RATE = 0.5

export function isValidFeeRate(rate: unknown): rate is number {
  return typeof rate === 'number' && Number.isFinite(rate) && rate >= 0 && rate < MAX_PRACTITIONER_FEE_RATE
}

/** 0.125 → "12.5%", 0.1 → "10%". */
export function formatFeeRate(rate: number): string {
  return `${Number((rate * 100).toFixed(2))}%`
}
