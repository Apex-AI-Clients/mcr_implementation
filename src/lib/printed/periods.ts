import type { PrintedColumn, PrintedStatementKind } from './types'

/**
 * Dates and periods as printed in a statement's title block and column
 * headers. Pure.
 *
 * Title block:  "For the year ended 30 June 2024", "for the period ended 30 June 2022",
 *               "For the 3 months ended 30 September 2026",
 *               "For the period 1 July 2026 to 15 October 2026",
 *               "July 2021 - June 2022", "As of June 30, 2024", "As at 30 JUN 2024"
 * Headers:      "2024", "30 JUNE 2024", "30 JUN 2024", "Total", "JULY-SEPT 2026"
 *
 * 12 months ending 30 June is the annual statement for that financial year,
 * whatever the wording; anything shorter is the current period.
 */

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
}
const MONTH = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)'
const DAY_MONTH_YEAR = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH}\\.?,?\\s+(\\d{4})\\b`, 'i')
const MONTH_DAY_YEAR = new RegExp(`\\b${MONTH}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, 'i')
const NUMERIC_DATE = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/
const MONTH_RANGE = new RegExp(`\\b${MONTH}\\s+(\\d{4})\\s*[-–—to]+\\s*${MONTH}\\s+(\\d{4})\\b`, 'i')

const month = (name: string) => MONTHS[name.toLowerCase().slice(0, name.toLowerCase().startsWith('sept') ? 4 : 3)]
const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()

/** The first date printed in the text, as ISO; null when none. */
export function findDate(text: string): string | null {
  let m = DAY_MONTH_YEAR.exec(text)
  if (m) return iso(Number(m[3]), month(m[2]), Number(m[1]))
  m = MONTH_DAY_YEAR.exec(text)
  if (m) return iso(Number(m[3]), month(m[1]), Number(m[2]))
  m = NUMERIC_DATE.exec(text)
  if (m) return iso(Number(m[3]), Number(m[2]), Number(m[1]))
  return null
}

export function financialYearOf(isoDate: string): number {
  const [y, m] = isoDate.split('-').map(Number)
  return m >= 7 ? y + 1 : y
}

/** The day after the date `months` months before `end` ("3 months ended 30 Sep" starts 1 Jul). */
function startFromMonths(end: string, months: number): string {
  const [y, m, d] = end.split('-').map(Number)
  let sm = m - months
  let sy = y
  while (sm <= 0) {
    sm += 12
    sy -= 1
  }
  // A period ending on a month's last day starts on the 1st of a month.
  if (d === lastDay(y, m)) return iso(sm === 12 ? sy + 1 : sy, sm === 12 ? 1 : sm + 1, 1)
  const start = new Date(Date.UTC(sy, sm - 1, d + 1))
  return start.toISOString().slice(0, 10)
}

/** What the title block says about the period, before the column headers. */
export interface TitlePeriod {
  start: string | null
  end: string | null
  /** "year ended" (12), "3 months ended" (3); null when not said. */
  months: number | null
}

export function titlePeriod(lines: string[]): TitlePeriod {
  for (const line of lines) {
    const range = new RegExp(`period\\s+(?:from\\s+)?(.+?)\\s+to\\s+(.+)`, 'i').exec(line)
    if (range) {
      const start = findDate(range[1])
      const end = findDate(range[2])
      if (start && end) return { start, end, months: null }
    }
    const months = MONTH_RANGE.exec(line)
    if (months) {
      const start = iso(Number(months[2]), month(months[1]), 1)
      const ey = Number(months[4])
      const em = month(months[3])
      return { start, end: iso(ey, em, lastDay(ey, em)), months: null }
    }
    const ended = /\b(year|period|(\d{1,2})\s+months?)\s+end(?:ed|ing)\b(.*)/i.exec(line)
    if (ended) {
      const end = findDate(ended[3])
      if (end) {
        const n = ended[2] ? Number(ended[2]) : ended[1].toLowerCase() === 'year' ? 12 : null
        return { start: n ? startFromMonths(end, n) : null, end, months: n }
      }
    }
    const asAt = /\bas\s+(?:at|of)\b(.*)/i.exec(line)
    if (asAt) {
      const end = findDate(asAt[1])
      if (end) return { start: null, end, months: null }
    }
  }
  return { start: null, end: null, months: null }
}

const YEAR_ONLY = /^(?:FY\s?)?(\d{4})$/i

/**
 * One column's period, from its header and the title block. Null when neither
 * says (the caller reports the header as unread).
 */
export function columnPeriod(header: string, title: TitlePeriod, kind: PrintedStatementKind): PrintedColumn | null {
  let end: string | null = findDate(header)
  let start: string | null = null
  const year = YEAR_ONLY.exec(header.trim())
  if (!end && year) {
    // "2024" under "for the year ended 30 June 2024": the title's day and month, the header's year.
    const y = Number(year[1])
    if (title.end) {
      const [, m, d] = title.end.split('-').map(Number)
      end = iso(y, m, Math.min(d, lastDay(y, m)))
    } else {
      end = iso(y, 6, 30)
    }
  }
  if (!end) end = title.end
  if (!end) return null

  if (kind === 'profit_and_loss') {
    if (title.end === end) start = title.start
    else if (title.months) start = startFromMonths(end, title.months)
  }
  const [, m, d] = end.split('-').map(Number)
  const endsJune30 = m === 6 && d === 30
  const fullYear =
    kind === 'balance_sheet'
      ? endsJune30
      : endsJune30 && (start === null || start === startFromMonths(end, 12)) && (title.months === null || title.months === 12)
  if (kind === 'profit_and_loss' && start === null) {
    // Annual: the 12 months to 30 June. Current period: from 1 July of its financial year.
    start = fullYear ? startFromMonths(end, 12) : iso(financialYearOf(end) - 1, 7, 1)
  }
  return {
    header,
    periodStart: kind === 'balance_sheet' ? null : start,
    periodEnd: end,
    kind: fullYear ? 'annual' : 'current_period',
    financialYear: financialYearOf(end),
  }
}
