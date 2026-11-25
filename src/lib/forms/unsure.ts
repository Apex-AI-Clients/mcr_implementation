import type { FieldValue } from './types'

/**
 * "Unsure" for a date nobody knows yet (Gabby, 24 Nov 2026: Part B's B24). Stored as the answer
 * itself; the PDF engine writes the word across the date's boxes instead of a date. Pure.
 */
export const UNSURE = 'Unsure'

export const isUnsure = (value: FieldValue): boolean => typeof value === 'string' && value.trim().toLowerCase() === 'unsure'

/** Part B's B24 dates: each starts at "Unsure" unless pre-filled, and can be switched either way. */
export const B24_DATE_KEYS = [
  'b24_itr_start',
  'b24_itr_end',
  'b24_bas_start',
  'b24_bas_end',
  'b24_stp_start',
  'b24_stp_end',
  'b24_sgc_start',
  'b24_sgc_end',
] as const

export const UNSURE_TOGGLE_KEYS: ReadonlySet<string> = new Set(B24_DATE_KEYS)
