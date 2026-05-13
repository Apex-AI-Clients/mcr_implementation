import { parse } from 'csv-parse/sync'
import { parse as parseDate, isValid } from 'date-fns'
import type { ParsedCsv, ParsedRow } from './types'

const EXPECTED_HEADER = [
  'Processed date',
  'Effective date',
  'Description',
  'Debit (DR)',
  'Credit (CR)',
  'Balance',
]

const DATE_FORMAT = 'dd MMM yyyy'

function parseAtoDate(raw: string): Date | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const d = parseDate(trimmed, DATE_FORMAT, new Date())
  return isValid(d) ? d : null
}

/**
 * Parse a currency cell from the ATO CSV.
 * Strips $, commas, and whitespace. Returns null for empty cells.
 * Balance column carries a trailing " DR" (positive) or " CR" (negative) suffix;
 * pass isSigned=true to handle it. Debit/Credit columns are always positive.
 */
function parseCurrency(raw: string, isSigned = false): number | null {
  const trimmed = raw.trim()
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
 * Parse an ATO Activity Statement CSV into typed rows.
 *
 * Format:
 *   Line 1: statement label (single quoted cell)
 *   Line 2: company name   (single quoted cell)
 *   Line 3: column header row
 *   Lines 4+: data rows
 */
export function parseActivityStatementCsv(csvText: string): ParsedCsv {
  const allRows: string[][] = parse(csvText, {
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
