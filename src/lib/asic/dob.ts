/**
 * Directors' dates of birth, at whatever precision is known.
 *
 * ASIC gives a full date today, but it is consulting on showing the year only
 * from July 2027, and staff typing one in may only know the month and year. So
 * a date of birth here is ISO at one of three precisions, and never padded out
 * to look more certain than it is — "1970" must not become "1970-01-01":
 *
 *   stored / ISO     shown and typed
 *   '1970-05-01'     '01/05/1970'
 *   '1970-05'        '05/1970'
 *   '1970'           '1970'
 *   null             ''            (missing is allowed)
 *
 * Browser-safe: pure functions, shared by the mapper, the forms and the card.
 */

const EARLIEST_YEAR = 1900

export type DobParse =
  | { kind: 'empty' }
  | { kind: 'ok'; iso: string }
  | { kind: 'invalid'; message: string }

export const DOB_FORMAT_MESSAGE = 'Enter the date as DD/MM/YYYY, MM/YYYY or YYYY.'
export const DOB_FUTURE_MESSAGE = 'That date is in the future.'

function daysInMonth(year: number, month: number): number {
  // Day 0 of the next month is the last day of this one.
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/**
 * Checks the parts and builds the ISO string, or says why not. `now` bounds
 * the year so a typo like 2970 is caught; tests pass it in.
 */
function build(
  year: number,
  month: number | null,
  day: number | null,
  now: Date | null,
): DobParse {
  const invalid: DobParse = { kind: 'invalid', message: DOB_FORMAT_MESSAGE }

  if (year < EARLIEST_YEAR) return invalid
  if (month !== null && (month < 1 || month > 12)) return invalid
  if (day !== null && (month === null || day < 1 || day > daysInMonth(year, month))) return invalid

  const iso =
    day !== null ? `${year}-${pad(month!)}-${pad(day)}` : month !== null ? `${year}-${pad(month)}` : String(year)

  if (now) {
    // Compared at the same precision as the value: "05/2026" in May 2026 is
    // fine, June 2026 is not.
    const today = now.toISOString().slice(0, iso.length)
    if (iso > today) return { kind: 'invalid', message: DOB_FUTURE_MESSAGE }
  }

  return { kind: 'ok', iso }
}

/**
 * What somebody typed -> ISO.
 *
 * Accepts '/', '-', '.' or spaces between the parts, one- or two-digit day and
 * month, and an ISO date pasted in as-is. Day first, always — this is an
 * Australian practice, and "05/06/1970" is the 5th of June.
 */
export function parseDob(input: string, now: Date = new Date()): DobParse {
  const value = input.trim()
  if (!value) return { kind: 'empty' }

  let match = /^(\d{1,2})[/.\-\s](\d{1,2})[/.\-\s](\d{4})$/.exec(value)
  if (match) return build(Number(match[3]), Number(match[2]), Number(match[1]), now)

  match = /^(\d{1,2})[/.\-\s](\d{4})$/.exec(value)
  if (match) return build(Number(match[2]), Number(match[1]), null, now)

  match = /^(\d{4})$/.exec(value)
  if (match) return build(Number(match[1]), null, null, now)

  // ISO, at any of the three precisions.
  match = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(value)
  if (match) {
    return build(Number(match[1]), Number(match[2]), match[3] ? Number(match[3]) : null, now)
  }

  return { kind: 'invalid', message: DOB_FORMAT_MESSAGE }
}

/**
 * A provider's or a stored value -> ISO, or null if it is not a date.
 *
 * Lenient about a trailing time ("1970-05-01T00:00:00Z" -> '1970-05-01') and
 * strict about everything else: a value that is not a real date is dropped
 * rather than shown, because a wrong date of birth on an insolvency file is
 * worse than a blank one. No future check — the provider is not typing.
 */
export function normaliseIsoDob(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?(?:T.*)?$/.exec(value.trim())
  if (!match) return null
  const parsed = build(
    Number(match[1]),
    match[2] ? Number(match[2]) : null,
    match[3] ? Number(match[3]) : null,
    null,
  )
  return parsed.kind === 'ok' ? parsed.iso : null
}

/**
 * ISO -> how it is shown and edited. Anything unrecognised comes back as it
 * was, so a value this code does not understand is still visible to fix.
 */
export function formatDob(iso: string | null | undefined): string {
  if (!iso) return ''
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (match) return `${match[3]}/${match[2]}/${match[1]}`
  match = /^(\d{4})-(\d{2})$/.exec(iso)
  if (match) return `${match[2]}/${match[1]}`
  return iso
}
