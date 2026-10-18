/**
 * How a current (part-year) period is named everywhere it is shown: table
 * headers, tiles, the coverage table, the CSV, the AI summary prompt and the
 * prediction page's points. One place, so they can never disagree.
 *
 *   currentPeriodLabel   "FY2027 to date (1 Jul – 15 Oct 2026)"
 *   currentPeriodName    "FY2027 to date"
 *   currentPeriodRange   "1 Jul – 15 Oct 2026", or "1 Jul 2026 – 15 Jan 2027"
 *                        when the two dates fall in different calendar years
 *
 * An Australian financial year runs 1 July to 30 June, so FY2027 to date
 * starts 1 July 2026. A missing start date falls back to that.
 */

export interface PeriodDates {
  /** The FY the period falls in (FY2027 = 1 Jul 2026 – 30 Jun 2027). */
  financialYear: number
  /** ISO yyyy-mm-dd; null or missing means the start of the FY. */
  periodStartDate?: string | null
  /** ISO yyyy-mm-dd. */
  periodEndDate: string
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "2026-10-15" → { day: 15, month: 'Oct', year: 2026 }; null when it is not a date. */
function parts(iso: string | null | undefined): { day: number; month: string; year: number } | null {
  if (!iso) return null
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return null
  return { day: d.getUTCDate(), month: MONTHS[d.getUTCMonth()], year: d.getUTCFullYear() }
}

/** "15 Oct 2026". The ISO text itself when it is not a date. */
export function shortDate(iso: string): string {
  const p = parts(iso)
  return p ? `${p.day} ${p.month} ${p.year}` : iso
}

/** "FY2027 to date". */
export function currentPeriodName(p: Pick<PeriodDates, 'financialYear'>): string {
  return `FY${p.financialYear} to date`
}

/** "1 Jul – 15 Oct 2026"; "1 Jul 2026 – 15 Jan 2027" across calendar years. */
export function currentPeriodRange(p: PeriodDates): string {
  const end = parts(p.periodEndDate)
  const start = parts(p.periodStartDate) ?? parts(`${p.financialYear - 1}-07-01`)
  if (!end || !start) return `to ${p.periodEndDate}`
  return start.year === end.year
    ? `${start.day} ${start.month} – ${end.day} ${end.month} ${end.year}`
    : `${start.day} ${start.month} ${start.year} – ${end.day} ${end.month} ${end.year}`
}

/** "FY2027 to date (1 Jul – 15 Oct 2026)". */
export function currentPeriodLabel(p: PeriodDates): string {
  return `${currentPeriodName(p)} (${currentPeriodRange(p)})`
}

/** "15 Oct 2026 (FY2027 to date)": a balance-sheet figure at the period's end. */
export function currentPeriodAt(p: PeriodDates): string {
  return `${shortDate(p.periodEndDate)} (${currentPeriodName(p)})`
}

/** "Year ended 30 June 2026 not uploaded". */
export function yearNotUploadedNote(financialYear: number): string {
  return `Year ended 30 June ${financialYear} not uploaded`
}

/** "FY2022–FY2025", or "FY2025" for one year. */
export function yearSpan(years: readonly number[]): string {
  if (years.length === 0) return ''
  const sorted = [...years].sort((a, b) => a - b)
  return sorted.length === 1 ? `FY${sorted[0]}` : `FY${sorted[0]}–FY${sorted[sorted.length - 1]}`
}
