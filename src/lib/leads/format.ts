import type { Lead } from '@/types/leads'
import { STAGE_META, SOURCE_META } from './constants'

/**
 * Rendering and parsing edge for lead data.
 *
 * Money lives as integer cents everywhere else in the app; it only becomes a
 * string here. Dates are formatted against Australia/Sydney rather than the
 * host's timezone — these components render on a UTC server and hydrate in the
 * user's browser, and an unanchored `toLocaleDateString` disagrees across that
 * boundary by a whole day.
 */

const AU_TZ = 'Australia/Sydney'

// ============================================================
// Money
// ============================================================

/** Integer cents → "$41,500" (or "$41,500.75" when there are cents). */
export function formatDebt(cents: number): string {
  const hasCents = cents % 100 !== 0
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: hasCents ? 2 : 0,
  }).format(cents / 100)
}

/**
 * Parse a typed debt amount into integer cents.
 * Tolerates "$", thousands commas and surrounding spaces.
 * Returns null when the value isn't a positive number.
 */
export function parseDebtInput(raw: string): number | null {
  const cleaned = raw.replace(/[$,\s]/g, '')
  if (!cleaned) return null
  if (!/^\d*\.?\d+$/.test(cleaned)) return null
  const value = Number.parseFloat(cleaned)
  if (!Number.isFinite(value) || value <= 0) return null
  return Math.round(value * 100)
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

/** "0402915338" → "0402 915 338". Unrecognised input is returned as-is. */
export function formatPhone(raw: string): string {
  const digits = normalisePhone(raw)
  if (!/^04\d{8}$/.test(digits)) return raw
  return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`
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
  'Debt (AUD)',
  'State',
  'Stage',
  'Source',
  'Last action',
] as const

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/**
 * The current filtered view as CSV, same columns as the table.
 * Debt is emitted as a bare number and dates as ISO so the result is usable in
 * a spreadsheet rather than just readable.
 */
export function leadsToCsv(leads: Lead[]): string {
  const rows = leads.map((lead) =>
    [
      formatIsoDate(lead.createdAt),
      lead.name,
      lead.email,
      formatPhone(lead.phone),
      (lead.debtAmount / 100).toFixed(2),
      lead.state,
      STAGE_META[lead.stage].label,
      SOURCE_META[lead.source].label,
      formatIsoDate(lead.lastActionAt),
    ]
      .map(csvCell)
      .join(','),
  )
  return [CSV_COLUMNS.join(','), ...rows].join('\r\n')
}
