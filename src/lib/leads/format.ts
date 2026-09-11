import type { Lead } from '@/types/leads'
import { STAGE_META, SOURCE_META, ENTITY_TYPE_META, DEBT_PRESETS } from './constants'

/**
 * Rendering and parsing edge for lead data.
 *
 * Debt is a range in whole dollars, so there is no money parsing here — only
 * formatting and the comparisons the list needs. Dates are formatted against Australia/Sydney rather than the
 * host's timezone — these components render on a UTC server and hydrate in the
 * user's browser, and an unanchored `toLocaleDateString` disagrees across that
 * boundary by a whole day.
 */

const AU_TZ = 'Australia/Sydney'

// ============================================================
// Debt range
// ============================================================

const EM_DASH = '—'
const EN_DASH = '–'

/** "$125k" — rounded to the nearest thousand for the table. */
function short(dollars: number): string {
  return `$${Math.round(dollars / 1000)}k`
}

/** "$124,999" — the exact stored figure, for the record. */
function full(dollars: number): string {
  return `$${dollars.toLocaleString('en-AU')}`
}

/**
 * Debt as a human range.
 *
 *   both null  -> "—"          (never a blank cell)
 *   max null   -> "$150k+"       (open-ended, as the form posted it)
 *   min 0/null -> "Under $50k"
 *   min === max -> "$120k"      (a single typed figure, not a bracket)
 *   otherwise  -> "$100k – $125k"
 *
 * `style: 'full'` spells the figures out for the record; the table uses the
 * abbreviated form.
 */
export function formatDebtRange(
  min: number | null,
  max: number | null,
  style: 'short' | 'full' = 'short',
): string {
  const money = style === 'full' ? full : short

  if (min === null && max === null) return EM_DASH
  if (max === null) return `${money(min as number)}+`
  if (min === null || min === 0) return `Under ${money(max)}`
  // A free-text form yields a point figure ("120k"), not a bracket. Rendering
  // it as "$120k – $120k" would read like a parsing accident.
  if (min === max) return money(min)
  return `${money(min)} ${EN_DASH} ${money(max)}`
}

/**
 * A debt range as a select value, e.g. "100000:124999", "150000:" (open-ended)
 * or ":" (not given).
 *
 * The range itself is the option value rather than an index into DEBT_PRESETS,
 * so a lead whose range is not in the preset list can still be represented —
 * which matters because a free-text debt field yields point figures like
 * 120000:120000 that no preset will ever match.
 */
export function encodeDebtRange(min: number | null, max: number | null): string {
  return `${min ?? ''}:${max ?? ''}`
}

export function decodeDebtRange(value: string): { min: number | null; max: number | null } {
  const [rawMin = '', rawMax = ''] = value.split(':')
  const parse = (raw: string): number | null => {
    if (raw === '') return null
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? parsed : null
  }
  return { min: parse(rawMin), max: parse(rawMax) }
}

/**
 * Options for a debt select, plus the value that is currently selected.
 *
 * When the lead's range matches no preset the current range is prepended as its
 * own option. Without that the control would show "Not given" for a lead that
 * has a debt, and saving would silently wipe it.
 */
export function debtSelectOptions(
  min: number | null,
  max: number | null,
): { options: { value: string; label: string }[]; value: string } {
  const value = encodeDebtRange(min, max)
  const options = DEBT_PRESETS.map((preset) => ({
    value: encodeDebtRange(preset.min, preset.max),
    label: preset.label,
  }))

  if (!options.some((option) => option.value === value)) {
    options.unshift({ value, label: formatDebtRange(min, max, 'full') })
  }

  return { options, value }
}

/**
 * Does a lead's range reach a filter floor?
 *
 * An overlap test, not equality — a lead that only said "$150,000 or +" has to
 * appear under the $100k+ floor, because it might be anything above $150k.
 */
export function overlapsFloor(lead: Pick<Lead, 'debtMin' | 'debtMax'>, floor: number): boolean {
  if (lead.debtMax === null) return lead.debtMin === null ? false : lead.debtMin >= floor
  return lead.debtMax >= floor
}

/**
 * Largest debt first, by `debtMin`, with unknown debt last.
 *
 * Never sort by the formatted label — alphabetically "$100k" sorts above
 * "$500k".
 */
export function compareByDebtDesc(
  a: Pick<Lead, 'debtMin'>,
  b: Pick<Lead, 'debtMin'>,
): number {
  if (a.debtMin === null && b.debtMin === null) return 0
  if (a.debtMin === null) return 1
  if (b.debtMin === null) return -1
  return b.debtMin - a.debtMin
}

// ============================================================
// Phone
// ============================================================

/** Strip formatting and normalise +61 to a leading 0. */
export function normalisePhone(raw: string): string {
  const digits = raw.replace(/[\s()\-.]/g, '')
  if (digits.startsWith('+61')) return `0${digits.slice(3)}`
  if (digits.startsWith('61') && digits.length === 11) return `0${digits.slice(2)}`
  return digits
}

/** Australian mobile: 04xx xxx xxx, tolerant of spaces and +61 form. */
export function isValidAuMobile(raw: string): boolean {
  return /^04\d{8}$/.test(normalisePhone(raw))
}

/**
 * Phone number for display, in Australian conventions.
 *
 *   mobile      "0402915338" -> "0402 915 338"
 *   landline    "0298765432" -> "02 9876 5432"
 *   1300/1800   "1800123456" -> "1800 123 456"
 *   13 short    "131234"     -> "13 12 34"
 *   other                       returned untouched
 *
 * `normalisePhone` has already folded +61 down to a leading 0, so every shape
 * matched here is the national form.
 *
 * Anything unrecognised is returned exactly as entered rather than grouped on a
 * guess. That includes the ten-digit no-leading-zero shape this function used
 * to render as US "(415) 555-0123" — MCR's leads are Australian, so that
 * grouping was only ever going to mislead someone dialling.
 */
export function formatPhone(raw: string): string {
  const digits = normalisePhone(raw)

  // Mobile: 04xx xxx xxx
  if (/^04\d{8}$/.test(digits)) {
    return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`
  }

  // Geographic landline, area codes 02 / 03 / 07 / 08: 0X XXXX XXXX
  if (/^0[2378]\d{8}$/.test(digits)) {
    return `${digits.slice(0, 2)} ${digits.slice(2, 6)} ${digits.slice(6)}`
  }

  // Service numbers: 1300 XXX XXX and 1800 XXX XXX
  if (/^1[38]00\d{6}$/.test(digits)) {
    return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`
  }

  // The six-digit 13 form: 13 XX XX
  if (/^13\d{4}$/.test(digits)) {
    return `${digits.slice(0, 2)} ${digits.slice(2, 4)} ${digits.slice(4)}`
  }

  return raw
}

// ============================================================
// Email
// ============================================================

export function isValidEmail(raw: string): boolean {
  const value = raw.trim()
  if (!value || /\s/.test(value)) return false
  return /^[^@]+@[^@.]+(\.[^@.]+)+$/.test(value)
}

// ============================================================
// Dates
// ============================================================

/** Sydney calendar day as YYYY-MM-DD. */
function sydneyYmd(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: AU_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

/** Whole Sydney calendar days between an ISO timestamp and `now`. */
export function daysBetween(iso: string, now: Date = new Date()): number {
  const then = Date.parse(`${sydneyYmd(new Date(iso))}T00:00:00Z`)
  const today = Date.parse(`${sydneyYmd(now)}T00:00:00Z`)
  return Math.round((today - then) / 86_400_000)
}

/** "26 Aug" — the list column. */
export function formatShortDate(iso: string): string {
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: AU_TZ,
    day: 'numeric',
    month: 'short',
  }).format(new Date(iso))
}

/** "26 Aug 2026" — timeline entries and the record. */
export function formatFullDate(iso: string): string {
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: AU_TZ,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(iso))
}

/** ISO date for CSV, sortable in a spreadsheet. */
export function formatIsoDate(iso: string): string {
  return sydneyYmd(new Date(iso))
}

/** "Today" / "Yesterday" / "3 days ago" / "26 Aug 2026". */
export function formatAge(iso: string, now: Date = new Date()): string {
  const days = daysBetween(iso, now)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 30) return `${days} days ago`
  return formatFullDate(iso)
}

// ============================================================
// CSV export
// ============================================================

const CSV_COLUMNS = [
  'Date added',
  'Name',
  'Email',
  'Phone',
  // Two bare-number columns rather than one label: a single label column can't
  // be filtered or sorted in a spreadsheet, which is the point of the export.
  'Debt min',
  'Debt max',
  'Entity type',
  'State',
  'Message',
  'Stage',
  'Source',
  'Last action',
] as const

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/**
 * The current filtered view as CSV, same columns and order as the table.
 * Debt is emitted as two bare numbers and dates as ISO, so the result is
 * sortable and filterable rather than merely readable.
 */
export function leadsToCsv(leads: Lead[]): string {
  const rows = leads.map((lead) =>
    [
      formatIsoDate(lead.createdAt),
      lead.name,
      lead.email,
      formatPhone(lead.phone),
      lead.debtMin === null ? '' : String(lead.debtMin),
      lead.debtMax === null ? '' : String(lead.debtMax),
      lead.entityType ? ENTITY_TYPE_META[lead.entityType].label : '',
      lead.state ?? '',
      lead.message ?? '',
      STAGE_META[lead.stage].label,
      SOURCE_META[lead.source].label,
      formatIsoDate(lead.lastActionAt),
    ]
      .map(csvCell)
      .join(','),
  )
  return [CSV_COLUMNS.join(','), ...rows].join('\r\n')
}
