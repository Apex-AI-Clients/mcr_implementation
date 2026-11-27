/**
 * Every date the app shows or exports, in Australian form (Gabby, 24 Nov 2026). One formatter for
 * pages, tables, ⓘ, CSV / Excel / PDF exports and the CVL forms:
 *
 *   dateField      "19/11/2026"          fields and table cells
 *   dateText       "19 Nov 2026"         text
 *   monthYearText  "Nov 2026"
 *   dayMonthText   "19 Nov"              a list column where the year is plain
 *   dateTimeText   "19 Nov 2026, 3:04 pm"
 *
 * A date-only value ("2026-11-19") is that calendar day wherever the code runs; a moment
 * ("2026-11-19T03:00:00Z", a Date) is the day it is in Sydney. Months are fixed three-letter names:
 * never the locale's "Sept", never month-first. Pure; browser and server alike.
 */

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

export const SYDNEY = 'Australia/Sydney'

export type DateInput = string | Date | null | undefined

interface Parts {
  y: number
  m: number
  d: number
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/
const DMY = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/

/** The calendar day of a value: a date-only string as written; a moment as the day in Sydney. Null when it is not a date. */
export function dateParts(value: DateInput): Parts | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'string') {
    const s = value.trim()
    const iso = DATE_ONLY.exec(s.slice(0, 10))
    if (iso && (s.length === 10 || !/[T ]\d/.test(s.slice(10, 12)))) return valid(Number(iso[1]), Number(iso[2]), Number(iso[3]))
    const dmy = DMY.exec(s)
    if (dmy) return valid(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]))
  }
  const at = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(at.getTime())) return null
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: SYDNEY, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at)
  const get = (t: string) => Number(p.find((x) => x.type === t)?.value)
  return valid(get('year'), get('month'), get('day'))
}

function valid(y: number, m: number, d: number): Parts | null {
  if (!(y > 0) || m < 1 || m > 12 || d < 1) return null
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return d <= last ? { y, m, d } : null
}

const pad = (n: number) => String(n).padStart(2, '0')

/** "19/11/2026"; '' when not a date. */
export function dateField(value: DateInput): string {
  const p = dateParts(value)
  return p ? `${pad(p.d)}/${pad(p.m)}/${p.y}` : ''
}

/** "19 Nov 2026"; '' when not a date. */
export function dateText(value: DateInput): string {
  const p = dateParts(value)
  return p ? `${p.d} ${MONTHS[p.m - 1]} ${p.y}` : ''
}

/** "Nov 2026"; '' when not a date. */
export function monthYearText(value: DateInput): string {
  const p = dateParts(value)
  return p ? `${MONTHS[p.m - 1]} ${p.y}` : ''
}

/** "19 Nov"; '' when not a date. */
export function dayMonthText(value: DateInput): string {
  const p = dateParts(value)
  return p ? `${p.d} ${MONTHS[p.m - 1]}` : ''
}

/** "19 Nov 2026, 3:04 pm" in Sydney; '' when not a moment. */
export function dateTimeText(value: DateInput): string {
  if (value === null || value === undefined || value === '') return ''
  const at = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(at.getTime())) return ''
  const p = new Intl.DateTimeFormat('en-AU', { timeZone: SYDNEY, hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(at)
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? ''
  return `${dateText(at)}, ${get('hour')}:${get('minute')} ${get('dayPeriod').toLowerCase()}`
}

/** "19/11/2026" or "2026-11-19" typed in a date box → "2026-11-19"; null when it is not a whole date. */
export function isoFromTyped(typed: string): string | null {
  const s = typed.trim()
  const dmy = DMY.exec(s)
  const iso = DATE_ONLY.exec(s)
  const p = dmy ? valid(Number(dmy[3]), Number(dmy[2]), Number(dmy[1])) : iso ? valid(Number(iso[1]), Number(iso[2]), Number(iso[3])) : null
  return p ? `${p.y}-${pad(p.m)}-${pad(p.d)}` : null
}
