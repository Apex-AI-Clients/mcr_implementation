import type { FieldValue } from './types'

/**
 * "Unsure" for a date nobody knows yet. Stored as the answer itself; the PDF engine writes the word
 * across the date's boxes instead of a date. Pure.
 *
 * Gabby, 24 Nov 2026: Part B's B24. The user, 27 Nov 2026: every date on every CVL form can be
 * "Unsure", and every date not pre-filled (and not filled from Form 509's summary date) starts at
 * "Unsure" (prefill.ts putUnsureDates).
 */
export const UNSURE = 'Unsure'

export const isUnsure = (value: FieldValue): boolean => typeof value === 'string' && value.trim().toLowerCase() === 'unsure'

/** A date on a form, whichever way the official PDF prints it: date with slashes, one box per digit, or a typed date. */
export const isDateKind = (f: { type: string; format?: string }): boolean =>
  f.type === 'date' || f.type === 'datecells' || (f.type === 'text' && f.format === 'date')

/** Part B's B24 dates (the first dates to take "Unsure", 24 Nov 2026). */
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
