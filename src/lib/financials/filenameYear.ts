/**
 * The financial year a filename points at — a FALLBACK only. The statement
 * headings decide the year (see resolveYear.ts); this is used when a document
 * has no readable headings, and to warn when the two disagree.
 *
 * Australian financial years end on 30 June and are named by their ending
 * year: "2024-2025", "2024-25", "23-24", "FY25" and "FY2025" are all FY2025.
 * A lone year ("Tax 2024") is taken as that FY, as before.
 *
 * Returns null rather than guessing when a name holds two different years that
 * are not one financial year ("2021-2025 summary"), or a year outside
 * 2000..next year.
 */

export type FilenameYearPattern =
  | 'fy_prefix' // FY2025, FY 2025, FY25, FY24-25
  | 'range' // 2024-2025, 2024-25, 2024-_2025, 23-24
  | 'iso_date' // 2025-06-30 (the FY that date falls in)
  | 'single_year' // 2025

export interface FilenameYear {
  year: number
  pattern: FilenameYearPattern
}

/** Any run of separators a filename puts between the two halves of a range. */
const SEP = String.raw`\s*[-_–—/.\s]+\s*_?`

function inRange(year: number, now: Date): boolean {
  return year >= 2000 && year <= now.getFullYear() + 1
}

/** "25" -> 2025. Two-digit years in filenames are this century. */
function expand(twoDigit: string): number {
  return 2000 + parseInt(twoDigit, 10)
}

/** The FY (ending year) a calendar date falls in. */
export function financialYearOf(year: number, month: number): number {
  return month >= 7 ? year + 1 : year
}

export function parseFilenameYear(filename: string, now: Date = new Date()): FilenameYear | null {
  // Drop the extension and anything that is not part of the name proper.
  const name = filename.replace(/\.[a-z0-9]{2,4}$/i, '')

  const ok = (year: number, pattern: FilenameYearPattern): FilenameYear | null =>
    inRange(year, now) ? { year, pattern } : null

  // 1. FY prefix. "FY24-25" and "FY2024-25" are ranges written after FY.
  const fyRange = new RegExp(String.raw`(?<![a-z])fy\s*-?\s*(20\d{2}|\d{2})${SEP}(20\d{2}|\d{2})(?!\d)`, 'i').exec(name)
  if (fyRange) {
    const start = fyRange[1].length === 4 ? parseInt(fyRange[1], 10) : expand(fyRange[1])
    const end = fyRange[2].length === 4 ? parseInt(fyRange[2], 10) : expand(fyRange[2])
    if (end === start + 1) return ok(end, 'fy_prefix')
  }
  const fy = /(?<![a-z])fy\s*-?\s*(20\d{2}|\d{2})(?!\d)/i.exec(name)
  if (fy) {
    return ok(fy[1].length === 4 ? parseInt(fy[1], 10) : expand(fy[1]), 'fy_prefix')
  }

  // 2. ISO dates are read before ranges, so "2025-06-30" is not "2025-06".
  const isoDates = [...name.matchAll(/(?<!\d)(20\d{2})-(\d{2})-(\d{2})(?!\d)/g)]
  const withoutDates = name.replace(/(?<!\d)(20\d{2})-(\d{2})-(\d{2})(?!\d)/g, ' ')

  // 3. Ranges: the two years must be consecutive, or it is not one FY.
  const ranges: number[] = []
  const fourFour = new RegExp(String.raw`(?<!\d)(20\d{2})${SEP}(20\d{2})(?!\d)`, 'g')
  for (const m of withoutDates.matchAll(fourFour)) {
    const [a, b] = [parseInt(m[1], 10), parseInt(m[2], 10)]
    if (b === a + 1) ranges.push(b)
  }
  const fourTwo = new RegExp(String.raw`(?<!\d)(20\d{2})${SEP}(\d{2})(?!\d)`, 'g')
  for (const m of withoutDates.matchAll(fourTwo)) {
    const a = parseInt(m[1], 10)
    if (parseInt(m[2], 10) === (a + 1) % 100) ranges.push(a + 1)
  }
  const twoTwo = new RegExp(String.raw`(?<!\d)(\d{2})${SEP}(\d{2})(?!\d)`, 'g')
  for (const m of withoutDates.matchAll(twoTwo)) {
    const [a, b] = [parseInt(m[1], 10), parseInt(m[2], 10)]
    // Two-digit pairs are only read as years when they are consecutive and
    // plausible, so "30-06" or "01-12" never become a year.
    if (b === a + 1 && a >= 10) ranges.push(expand(m[2]))
  }
  const distinctRanges = [...new Set(ranges)]
  if (distinctRanges.length === 1) return ok(distinctRanges[0], 'range')
  if (distinctRanges.length > 1) return null

  // 4. Lone years. More than one different year is ambiguous.
  const singles = [
    ...new Set([...withoutDates.matchAll(/(?<!\d)(20\d{2})(?!\d)/g)].map((m) => parseInt(m[1], 10))),
  ]
  if (singles.length === 1) return ok(singles[0], 'single_year')
  if (singles.length > 1) return null

  // 5. Only a date: the FY it falls in.
  const fys = [
    ...new Set(isoDates.map((m) => financialYearOf(parseInt(m[1], 10), parseInt(m[2], 10)))),
  ]
  if (fys.length === 1) return ok(fys[0], 'iso_date')
  return null
}
