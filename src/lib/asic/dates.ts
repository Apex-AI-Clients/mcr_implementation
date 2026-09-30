/**
 * Dates on an ASIC extract, and dates of birth as staff type them.
 *
 * A date of birth is kept as ISO 8601 at the precision it was given:
 *
 *   "14/03/1970" <-> "1970-03-14"
 *   "03/1970"    <-> "1970-03"
 *   "1970"       <-> "1970"
 *
 * The shorter forms exist because ASIC is consulting on showing only the year
 * of birth from July 2027. Pure, and safe in the browser.
 */

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
]

/** Australian zone abbreviations ASIC might print, as UTC offsets. */
const ZONE_OFFSETS: Record<string, string> = {
  AEST: '+10:00',
  AEDT: '+11:00',
  ACST: '+09:30',
  ACDT: '+10:30',
  AWST: '+08:00',
}

const MIN_BIRTH_YEAR = 1900

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function isRealDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  )
}

export type DobParse = { ok: true; iso: string | null } | { ok: false; message: string }

/**
 * What somebody typed into a date-of-birth box -> ISO, or why not.
 *
 * Blank is allowed and means "not known" (iso: null). The year must be a
 * plausible birth year: from 1900 to this year.
 */
export function parseDobInput(raw: string, now: Date = new Date()): DobParse {
  const value = raw.trim()
  if (!value) return { ok: true, iso: null }

  const invalid = { ok: false as const, message: 'Use DD/MM/YYYY, MM/YYYY or YYYY.' }
  const match = /^(?:(?:(\d{1,2})[/.-])?(\d{1,2})[/.-])?(\d{4})$/.exec(value)
  if (!match) return invalid

  const [, dayText, monthText, yearText] = match
  const year = Number(yearText)
  if (year < MIN_BIRTH_YEAR || year > now.getFullYear()) {
    return { ok: false, message: `The year has to be between ${MIN_BIRTH_YEAR} and ${now.getFullYear()}.` }
  }
  if (!monthText) return { ok: true, iso: String(year) }

  const month = Number(monthText)
  if (month < 1 || month > 12) return { ok: false, message: 'That month does not exist.' }
  if (!dayText) return { ok: true, iso: `${year}-${pad(month)}` }

  const day = Number(dayText)
  if (!isRealDate(year, month, day)) return { ok: false, message: 'That date does not exist.' }
  return { ok: true, iso: `${year}-${pad(month)}-${pad(day)}` }
}

/** Whether a stored value is one of the three ISO shapes above. */
export function isIsoDob(value: string): boolean {
  const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(value)
  if (!match) return false
  const [, y, m, d] = match
  if (!m) return true
  if (Number(m) < 1 || Number(m) > 12) return false
  if (!d) return true
  return isRealDate(Number(y), Number(m), Number(d))
}

/** Stored ISO -> how it is shown and edited: "14/03/1970", "03/1970", "1970". */
export function formatDob(iso: string | null | undefined): string {
  if (!iso) return ''
  const [year, month, day] = iso.split('-')
  if (day) return `${day}/${month}/${year}`
  if (month) return `${month}/${year}`
  return year
}

/**
 * The date at the start of an extract's "Born:" value, which goes on to give a
 * place and a country. Only the date is kept; the rest is never returned.
 *
 * "14/03/1970, SAMPLETOWN, VIC" -> "1970-03-14". Also takes the year-only and
 * month-and-year forms ASIC may move to. null when there is no usable date.
 */
export function dobFromBornValue(value: string): string | null {
  const match = /^\s*((?:\d{1,2}\/)?(?:\d{1,2}\/)?\d{4})(?=\b|,|\s|$)/.exec(value)
  if (!match) return null
  const parsed = parseDobInput(match[1])
  return parsed.ok ? parsed.iso : null
}

/**
 * The cover's "Date/Time" -> ISO with its offset, or null.
 *
 * "23 September 2026 AEST 02:07:38 PM" -> "2026-09-23T14:07:38+10:00".
 * The zone may come before or after the time; with no zone, AEST is assumed,
 * which is what ASIC prints.
 */
export function parseExtractDateTime(value: string): string | null {
  const text = value.replace(/\s+/g, ' ').trim()
  const dateMatch = /(\d{1,2}) ([A-Za-z]+) (\d{4})/.exec(text)
  if (!dateMatch) return null

  const day = Number(dateMatch[1])
  const month = MONTHS.indexOf(dateMatch[2].toLowerCase()) + 1
  const year = Number(dateMatch[3])
  if (month === 0 || !isRealDate(year, month, day)) return null

  const zoneMatch = /\b(AEST|AEDT|ACST|ACDT|AWST)\b/i.exec(text)
  const offset = ZONE_OFFSETS[(zoneMatch?.[1] ?? 'AEST').toUpperCase()]

  let hours = 0
  let minutes = 0
  let seconds = 0
  const timeMatch = /(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i.exec(text)
  if (timeMatch) {
    hours = Number(timeMatch[1])
    minutes = Number(timeMatch[2])
    seconds = Number(timeMatch[3] ?? 0)
    const meridiem = timeMatch[4]?.toUpperCase()
    if (meridiem === 'PM' && hours < 12) hours += 12
    if (meridiem === 'AM' && hours === 12) hours = 0
    if (hours > 23 || minutes > 59 || seconds > 59) return null
  }

  return `${year}-${pad(month)}-${pad(day)}T${pad(hours)}:${pad(minutes)}:${pad(seconds)}${offset}`
}

/** "2026-09-23T14:07:38+10:00" -> "23 September 2026", in the extract's own zone. */
export function formatExtractDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!match) return ''
  const month = MONTHS[Number(match[2]) - 1]
  if (!month) return ''
  return `${Number(match[3])} ${month.charAt(0).toUpperCase()}${month.slice(1)} ${match[1]}`
}
