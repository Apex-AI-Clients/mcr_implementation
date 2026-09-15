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
 * Country calling codes, for splitting the code off an international number.
 *
 * A code is one to three digits and nothing in the number itself says which,
 * so it cannot be derived — it has to be known. This is the set that actually
 * turns up on MCR's leads (migrant directors, overseas accountants) rather
 * than the full ITU list; an unknown code is grouped without being split,
 * which costs a space. A guessed split is worse than that: it moves the
 * boundary between the country code and the subscriber number, and someone
 * dialling off a mistyped grouping gets a wrong number.
 *
 * Longest match wins, so no three-digit entry may begin with a two-digit one
 * and no two-digit entry with a one-digit one. That holds in the real
 * numbering plan — +7 and +1 have no +7x / +1x neighbours, +852 no +85 — and
 * has to keep holding for anything added here.
 */
const COUNTRY_CALLING_CODES: ReadonlySet<string> = new Set([
  // One digit
  '1', // US / Canada
  '7', // Russia / Kazakhstan
  // Two digits
  '20', '27', '30', '31', '32', '33', '34', '36', '39',
  '40', '41', '43', '44', '45', '46', '47', '48', '49',
  '51', '52', '54', '55', '56', '57',
  '60', '62', '63', '64', '65', '66',
  '81', '82', '84', '86',
  '90', '91', '92', '94', '95', '98',
  // Three digits
  '212', '233', '234', '254', '255', '256', '263',
  '351', '353', '356', '358', '359',
  '370', '371', '372', '375', '380', '381', '385', '386',
  '420', '421',
  '852', '853', '855', '856', '880', '886',
  '960', '962', '964', '965', '966', '968',
  '971', '972', '973', '974', '977',
  '992', '993', '994', '995', '996', '998',
])

/**
 * Digits in groups of three, the last group running on to four rather than
 * leaving one digit stranded: ten digits read "701 810 2917", not
 * "701 810 291 7".
 *
 * Only spaces are inserted — the digits and their order are never touched.
 */
function groupInThrees(digits: string): string {
  const groups: string[] = []
  let rest = digits
  while (rest.length > 4) {
    groups.push(rest.slice(0, 3))
    rest = rest.slice(3)
  }
  if (rest) groups.push(rest)
  return groups.join(' ')
}

/**
 * Australian-style grouping for a number that matched no known shape.
 *
 *   10 digits  -> XXXX XXX XXX   "1234567890"  -> "1234 567 890"
 *    9 digits  -> XXXX XXX XX    "945359847"   -> "9453 598 47"
 *   11+ digits -> XXXX XXX XXX, then whatever is left after one more space
 *                                "86856416735" -> "8685 641 673 5"
 *   under 9    -> threes from the left
 *
 * Nine and ten share a branch: the same three slices give 4+3+3 on ten and
 * 4+3+2 on nine, because the last slice simply runs short.
 *
 * Note which nine-digit numbers actually get here. The stripped-zero mobile
 * and landline cases in `describePhone` run first and claim every nine-digit
 * number opening on 2, 3, 4, 7 or 8 — "745359847" is the Brisbane landline
 * 07 4535 9847, not "7453 598 47". Only 0, 1, 5, 6 and 9 openings fall
 * through, which is the right way round: a reconstructable number beats a
 * cosmetic one.
 *
 * This is cosmetic and nothing more. It makes no claim that the number is
 * dialable — an eleven-digit string is not an Australian number whatever
 * spaces are put in it, and `describePhone` still reports it as unrecognised
 * so the table can dim it. What it buys is a column of consistent shapes that
 * the eye can run down, which is the whole of what it is for.
 *
 * Only spaces are inserted. Every digit that came in comes out, in order.
 */
function groupBestEffort(digits: string): string {
  if (digits.length < 9) return groupInThrees(digits)
  const head = `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7, 10)}`
  const remainder = digits.slice(10)
  return remainder ? `${head} ${remainder}` : head
}

/** Split a leading country code off, or null when it is not one we know. */
function splitCountryCode(digits: string): { code: string; rest: string } | null {
  for (const length of [3, 2, 1]) {
    const code = digits.slice(0, length)
    if (COUNTRY_CALLING_CODES.has(code)) return { code, rest: digits.slice(length) }
  }
  return null
}

/**
 * Phone number for display, in Australian conventions.
 *
 *   mobile        "0402915338"    -> "0402 915 338"
 *   mobile, no 0  "412345678"     -> "0412 345 678"
 *   landline      "0298765432"    -> "02 9876 5432"
 *   landline, no 0 "298765432"    -> "02 9876 5432"
 *   1300/1800     "1800123456"    -> "1800 123 456"
 *   13 short      "131234"        -> "13 12 34"
 *   overseas      "+917018102917" -> "+91 701 810 2917"
 *   anything else "86856416735"   -> "8685 641 673 5"   (see groupBestEffort)
 *   no digits     "switchboard"   -> returned untouched
 *
 * `normalisePhone` has already folded +61 down to a leading 0, so every
 * Australian shape matched here is the national form — and anything still
 * carrying a "+" by the international case is, by construction, not Australian.
 *
 * The known shapes above are tried in order and win outright; only what
 * reaches the end is grouped best-effort. So a real 04xx number is never
 * reshaped by the fallback, and the fallback never has to be right about
 * anything — it is there so the column scans, not so the number dials.
 *
 * `describePhone` reports WHETHER the number matched a known shape, separately
 * from how it is rendered, because the table dims the ones that did not. Since
 * every number with digits in it is now grouped, that flag is the ONLY thing
 * left distinguishing a real number from the spam the website form collects —
 * it cannot be re-derived from the output, and nothing should try.
 */
export interface PhoneDisplay {
  /** The number as it should be shown. Never has a digit added or moved. */
  text: string
  /**
   * Did it match a known Australian or international shape? `false` does NOT
   * mean `text` is ungrouped — it is grouped best-effort — only that nothing
   * vouches for the number. The caller should mark it as such.
   */
  recognised: boolean
}

export function describePhone(raw: string): PhoneDisplay {
  const digits = normalisePhone(raw)
  const grouped = (text: string): PhoneDisplay => ({ text, recognised: true })

  // Mobile: 04xx xxx xxx
  if (/^04\d{8}$/.test(digits)) {
    return grouped(`${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`)
  }

  // The same mobile with its leading 0 stripped — a form handler that coerces
  // the field to a number loses it, and it is the commonest shape MCR sees
  // after the two canonical ones. Nine digits opening on a 4 are a mobile and
  // nothing else in the Australian plan, so the 0 goes back without a guess.
  if (/^4\d{8}$/.test(digits)) {
    return grouped(`0${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`)
  }

  // Geographic landline, area codes 02 / 03 / 07 / 08: 0X XXXX XXXX
  if (/^0[2378]\d{8}$/.test(digits)) {
    return grouped(`${digits.slice(0, 2)} ${digits.slice(2, 6)} ${digits.slice(6)}`)
  }

  // The same landline minus its leading 0. 2, 3, 7 and 8 are the only
  // geographic area codes, so nine digits opening on one of them reconstruct
  // unambiguously too.
  if (/^[2378]\d{8}$/.test(digits)) {
    return grouped(`0${digits.slice(0, 1)} ${digits.slice(1, 5)} ${digits.slice(5)}`)
  }

  // Service numbers: 1300 XXX XXX and 1800 XXX XXX
  if (/^1[38]00\d{6}$/.test(digits)) {
    return grouped(`${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`)
  }

  // The six-digit 13 form: 13 XX XX. Shorter than the nine-digit floor the
  // stripped-zero cases work to, and deliberately so: it is a known shape in
  // its own right, not a number that happens to be six digits long.
  if (/^13\d{4}$/.test(digits)) {
    return grouped(`${digits.slice(0, 2)} ${digits.slice(2, 4)} ${digits.slice(4)}`)
  }

  // Still carrying a "+", so it is not Australian: `normalisePhone` folded +61
  // down to a leading 0 before any of the cases above could match. Group it as
  // +CC XXX XXX XXX.
  if (/^\+\d{6,15}$/.test(digits)) {
    const international = digits.slice(1)
    const split = splitCountryCode(international)
    // An unknown code is grouped whole rather than split on a guess. A missing
    // space is cosmetic; a boundary in the wrong place says the wrong digits
    // are the country code.
    if (!split) return grouped(`+${groupInThrees(international)}`)
    return grouped(
      split.rest ? `+${split.code} ${groupInThrees(split.rest)}` : `+${split.code}`,
    )
  }

  // No known shape. Grouped anyway, so the column scans — but flagged, so the
  // table can dim it. The website form has no captcha and a good share of what
  // lands here is spam; the spaces make it readable, the flag is what says it
  // is not worth a call.
  if (/^\d+$/.test(digits)) return { text: groupBestEffort(digits), recognised: false }

  // Digits mixed with something else — letters, a stray "+", an address pasted
  // into the phone field — or no digits at all. Grouping by digit count would
  // have to either drop the rest or space it at random, and both misrepresent
  // what was typed. Returned exactly as entered instead.
  return { text: raw, recognised: false }
}

/** The number as it should be shown. See `describePhone`. */
export function formatPhone(raw: string): string {
  return describePhone(raw).text
}

/** Did the number match a known shape? See `describePhone`. */
export function isRecognisedPhone(raw: string): boolean {
  return describePhone(raw).recognised
}

/** Title text for a number that matched nothing, so the wording is set once. */
export const UNRECOGNISED_PHONE_TITLE = "Number doesn't match a known phone format"

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
