import { parse } from 'csv-parse/sync'
import type { ParsedCsv, ParsedRow } from './types'

const EXPECTED_HEADER = [
  'Processed date',
  'Effective date',
  'Description',
  'Debit (DR)',
  'Credit (CR)',
  'Balance',
]

const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']

/** "Oct", "October", "Sept" → 9; anything else → undefined. */
function monthFromName(name: string): number | undefined {
  const n = name.toLowerCase()
  if (n.length < 3) return undefined
  if (n === 'sept') return 8
  const i = MONTH_NAMES.findIndex((m) => m.startsWith(n))
  return i === -1 ? undefined : i
}

/** Local midnight on that calendar day, or null when the day does not exist (31 Feb, month 13). */
function calendarDate(year: number, month: number, day: number): Date | null {
  if (!Number.isInteger(year) || year < 1900 || year > 2099) return null
  const d = new Date(year, month, day)
  return d.getFullYear() === year && d.getMonth() === month && d.getDate() === day ? d : null
}

/** Two-digit years are 20YY: the ATO account history starts this century. */
const fullYear = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y))

/** Excel's day 0 is 30 Dec 1899 (its 1900 leap-year bug is before March 1900, so it never matters here). */
const EXCEL_EPOCH = Date.UTC(1899, 11, 30)

/**
 * A date cell from an ATO account CSV, as the ATO writes it ("20 Oct 2026")
 * or as Excel or Google Sheets re-save it: "20-Oct-26", "20-Oct-2026",
 * "20/10/2026", "20/10/26", "2026-10-20", or an Excel serial number (46315).
 * A time of midnight after the date is ignored.
 *
 * Australian day-first order only: "10/20/2026" is not a date (there is no
 * month 20), never 20 October. Two-digit years are 20YY. Null for a blank or
 * unreadable cell — the analysis counts those (config.ts unparsedDateRows) and refuses
 * to give figures, rather than reading the row as on time.
 *
 * Returns local midnight, as the analysis has always used.
 */
export function parseAtoDate(raw: string): Date | null {
  // A stray quote, or the apostrophe a spreadsheet puts in front of text.
  const s = raw
    .replace(/^['"\s]+|["\s]+$/g, '')
    // A midnight time a spreadsheet may add: "20/10/2026 0:00", "2026-10-20T00:00:00.000Z".
    .replace(/(?:[T\s]+0?0:00(?::00(?:\.0+)?)?(?:\s*AM)?Z?)$/i, '')
  if (!s) return null

  // 20 Oct 2026 · 20-Oct-26 · 20-Oct-2026 · 20 October 2026 · 20/Oct/2026
  let m = s.match(/^(\d{1,2})[\s\-/.]+([A-Za-z]{3,9})\.?[\s\-/.,]+(\d{4}|\d{2})$/)
  if (m) {
    const month = monthFromName(m[2])
    return month === undefined ? null : calendarDate(fullYear(m[3]), month, Number(m[1]))
  }

  // 20/10/2026 · 20/10/26 · 20-10-2026 · 20.10.2026 (day first, always)
  m = s.match(/^(\d{1,2})([/\-.])(\d{1,2})\2(\d{4}|\d{2})$/)
  if (m) return calendarDate(fullYear(m[4]), Number(m[3]) - 1, Number(m[1]))

  // 2026-10-20 · 2026/10/20
  m = s.match(/^(\d{4})([/\-.])(\d{1,2})\2(\d{1,2})$/)
  if (m) return calendarDate(Number(m[1]), Number(m[3]) - 1, Number(m[4]))

  // An Excel serial: a whole number of days (32874 = 1 Jan 1990, 73050 = 31 Dec 2099).
  m = s.match(/^(\d{5})(?:\.0+)?$/)
  if (m) {
    const serial = Number(m[1])
    if (serial < 32874 || serial > 73050) return null
    const utc = new Date(EXCEL_EPOCH + serial * 86_400_000)
    return calendarDate(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate())
  }

  return null
}



/**
 * Parse a currency cell from the ATO CSV.
 * Strips $, commas, and whitespace. Returns null for empty cells.
 * Balance column carries a trailing " DR" (positive) or " CR" (negative) suffix;
 * pass isSigned=true to handle it. Debit/Credit columns are always positive.
 */
function parseCurrency(raw: string, isSigned = false): number | null {
  // A stray quote can survive on the last cell of a row (see the line-ending
  // note in parseActivityStatementCsv); it is never part of the amount.
  const trimmed = raw.replace(/"/g, '').trim()
  if (!trimmed) return null

  let multiplier = 1
  let s = trimmed

  if (isSigned) {
    if (s.endsWith(' DR')) {
      s = s.slice(0, -3)
    } else if (s.endsWith(' CR')) {
      s = s.slice(0, -3)
      multiplier = -1
    }
  }

  const numeric = parseFloat(s.replace(/[$,]/g, '').trim())
  if (isNaN(numeric)) return null
  return numeric * multiplier
}

const MONTH_MAP: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
}

/**
 * Extract the "period ending" date from a lodgement description.
 * Returns null if no period is found or it cannot be parsed.
 * Matches "for the period ending 30 Jun 23" / "for the period ending 31 Dec 2025" etc.
 * Returns a UTC midnight date so comparisons are timezone-safe.
 */
export function extractPeriodEnding(description: string): Date | null {
  const match = description.match(/period ending (\d{1,2}\s+\w{3}\s+(?:\d{2}|\d{4}))/i)
  if (!match) return null

  const parts = match[1].trim().split(/\s+/)
  if (parts.length !== 3) return null

  const day = parseInt(parts[0], 10)
  const month = MONTH_MAP[parts[1].toLowerCase().slice(0, 3)]
  const rawYear = parseInt(parts[2], 10)
  // Expand 2-digit year to 4-digit (assume century 2000)
  const year = parts[2].length === 2 ? 2000 + rawYear : rawYear

  if (isNaN(day) || month === undefined || isNaN(year)) return null

  // Use UTC to avoid timezone offset affecting the date value
  const d = new Date(Date.UTC(year, month, day))
  // Validate the constructed date (e.g. 31 Feb would roll over)
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month || d.getUTCDate() !== day) return null
  return d
}

/**
 * Whether a CSV is an ATO activity statement account export, from its own
 * content rather than its filename: line 1 is the statement label
 * ("Activity statement 002"), line 3 the six-column header. The income tax
 * and super account exports share that header, so the label decides.
 */
export function isActivityStatementCsv(csvText: string): boolean {
  let rows: string[][]
  try {
    // The first three lines are all that is needed.
    const head = csvText.replace(/\r\n?/g, '\n').split('\n').slice(0, 6).join('\n')
    rows = parse(head, { relax_column_count: true, relax_quotes: true, skip_empty_lines: true })
  } catch {
    return false
  }
  if (rows.length < 3) return false
  const label = rows[0]?.[0]?.trim() ?? ''
  const header = rows[2]
  return (
    /^activity statement\b/i.test(label) &&
    header.length === EXPECTED_HEADER.length &&
    EXPECTED_HEADER.every((col, i) => header[i].trim() === col)
  )
}

/**
 * Parse an ATO Activity Statement CSV into typed rows.
 *
 * Format:
 *   Line 1: statement label (single quoted cell)
 *   Line 2: company name   (single quoted cell)
 *   Line 3: column header row
 *   Lines 4+: data rows
 */
export function parseActivityStatementCsv(csvText: string): ParsedCsv {
  // ATO exports end lines with CRLF. With relax_quotes, csv-parse then keeps
  // the closing quote and the CR on the LAST cell of every row (the Balance),
  // so a balance such as "$1,000.00 DR" did not parse and every balance was lost.
  const allRows: string[][] = parse(csvText.replace(/\r\n?/g, '\n'), {
    relax_column_count: true,
    relax_quotes: true,
    skip_empty_lines: true,
  })

  if (allRows.length < 3) {
    throw new Error('Unexpected CSV preamble')
  }

  // Line 1: statement label — may have trailing empty cells on some ATO exports
  const labelRow = allRows[0]
  const labelValue = labelRow?.[0]?.trim()
  if (!labelRow || !labelValue || labelRow.slice(1).some((c) => c.trim() !== '')) {
    throw new Error('Unexpected CSV preamble')
  }
  const statementLabel = labelValue

  // Line 2: company name — same tolerance for trailing empty cells
  const companyRow = allRows[1]
  const companyValue = companyRow?.[0]?.trim()
  if (!companyRow || !companyValue || companyRow.slice(1).some((c) => c.trim() !== '')) {
    throw new Error('Unexpected CSV preamble')
  }
  const companyName = companyValue

  // Line 3: header
  const headerRow = allRows[2]
  const headerMatch =
    headerRow.length === EXPECTED_HEADER.length &&
    EXPECTED_HEADER.every((col, i) => headerRow[i].trim() === col)

  if (!headerMatch) {
    throw new Error('Unexpected CSV header')
  }

  const dataRows = allRows.slice(3)
  const rows: ParsedRow[] = dataRows.map((cells, idx) => {
    const rawProcessed = cells[0] ?? ''
    const rawEffective = cells[1] ?? ''
    const rawDescription = cells[2] ?? ''
    const rawDebit = cells[3] ?? ''
    const rawCredit = cells[4] ?? ''
    const rawBalance = cells[5] ?? ''

    // Strip leading apostrophe the ATO embeds for Excel safety
    const description = rawDescription.replace(/^'/, '').trim()

    return {
      rowIndex: idx,
      processedDate: parseAtoDate(rawProcessed),
      effectiveDate: parseAtoDate(rawEffective),
      rawProcessed,
      rawEffective,
      description,
      debit: parseCurrency(rawDebit),
      credit: parseCurrency(rawCredit),
      balance: parseCurrency(rawBalance, true),
      periodEnding: extractPeriodEnding(description),
    }
  })

  return { statementLabel, companyName, rows }
}
