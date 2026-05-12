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
    }
  })

  return { statementLabel, companyName, rows }
}
