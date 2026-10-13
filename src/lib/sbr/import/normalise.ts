/**
 * Cell normalisation for the historical-case import. Pure; no I/O.
 */

/**
 * The normalised name two rows (or a row and a stored case) match on:
 * lowercase; & = and; anything but a-z, 0-9 and space becomes a space; the
 * words pty, ltd, limited and the are dropped; spaces collapsed and trimmed.
 *
 * Must give the same answer as public.sbr_name_key (migration 0028), which
 * generates sbr_historical_cases.name_key.
 */
export function nameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\b(pty|ltd|limited|the)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * A cell as trimmed text. Numbers keep full precision (no display rounding).
 * A leading apostrophe that a spreadsheet adds to protect a formula-like cell
 * (our own rejected-rows CSV does this) is dropped.
 */
export function cellText(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  const s = String(value).trim()
  return /^'[=+\-@]/.test(s) ? s.slice(1) : s
}

/** Y / N / Yes / No, any case. Null for anything else. */
export function parseYesNo(value: unknown): boolean | null {
  const s = cellText(value).toLowerCase()
  if (s === 'y' || s === 'yes') return true
  if (s === 'n' || s === 'no') return false
  return null
}

/**
 * An amount or count: strips $, commas and spaces; a lone "-" (accounting
 * zero) is 0. Null when blank or not a number.
 */
export function parseNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const s = cellText(value).replace(/[$,\s]/g, '')
  if (s === '-') return 0
  if (s === '') return null
  // Number('') and Number('0x10') both "work"; only plain decimals count.
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(s)) return null
  return Number(s)
}

/** "NO PAYMENTS EVER", any case, with or without a full stop. */
export function isNoPaymentsEver(value: unknown): boolean {
  return /^no payments? ever\.?$/i.test(cellText(value))
}
