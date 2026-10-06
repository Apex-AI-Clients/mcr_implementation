import { describe, it, expect } from 'vitest'
import { parseFilenameYear } from '../filenameYear'
import { resolveDocumentYears } from '../resolveYear'

/** Filenames are synthetic but follow the patterns real uploads use. */

const NOW = new Date('2026-10-05T00:00:00Z')
const year = (name: string) => parseFilenameYear(name, NOW)?.year ?? null

describe('parseFilenameYear', () => {
  it.each([
    // Ranges name the year they END in.
    ['2024-2025_PROFIT_AND_LOSS.pdf', 2025],
    ['2024-25 Balance Sheet.pdf', 2025],
    ['2024-_2025_BALANCE_SHEET.pdf', 2025],
    ['2024 - 2025 financials.pdf', 2025],
    ['Balance_sheet_23-24.pdf', 2024],
    ['PnL 22_23.pdf', 2023],
    // FY prefixes.
    ['FY25 accounts.pdf', 2025],
    ['FY2025 accounts.pdf', 2025],
    ['Accounts FY 2024.pdf', 2024],
    ['FY24-25 P&L.pdf', 2025],
    // A lone year, as before.
    ['SAMPLE_CO_Tax 2024_signed.pdf', 2024],
    ['2023 - SAMPLE CO Financial Statements.pdf', 2023],
    // A date alone: the FY it falls in.
    ['Balance sheet 2026-05-04.pdf', 2026],
    ['Balance sheet 2025-06-30.pdf', 2025],
  ])('%s -> FY%s', (name, expected) => {
    expect(year(name)).toBe(expected)
  })

  it.each([
    ['financials.pdf'],
    ['Financials (1).pdf'],
    // Two different years that are not one FY: ambiguous, so no guess.
    ['2021-2025 summary.pdf'],
    ['Tax 2023 and 2025.pdf'],
    // Out of range.
    ['Accounts 1999.pdf'],
    ['Accounts 2031.pdf'],
    // Pairs that are not years.
    ['Scan 30-06.pdf'],
    ['Page 01-02.pdf'],
  ])('%s -> no year', (name) => {
    expect(year(name)).toBeNull()
  })

  it('reports which pattern it used', () => {
    expect(parseFilenameYear('FY25.pdf', NOW)?.pattern).toBe('fy_prefix')
    expect(parseFilenameYear('2024-2025.pdf', NOW)?.pattern).toBe('range')
    expect(parseFilenameYear('Tax 2024.pdf', NOW)?.pattern).toBe('single_year')
    expect(parseFilenameYear('BS 2026-05-04.pdf', NOW)?.pattern).toBe('iso_date')
  })

  it('takes a range over a lone signing date', () => {
    expect(year('2024-2025 P&L signed 2025-11-02.pdf')).toBe(2025)
  })
})

describe('resolveDocumentYears', () => {
  it('lets the headings decide when they name a year', () => {
    const resolved = resolveDocumentYears({ headingYears: [2025], currentPeriodYear: null }, '2024-2025_PROFIT_AND_LOSS.pdf', NOW)
    expect(resolved).toMatchObject({ annualYears: [2025], source: 'heading', conflict: null })
  })

  it('reports a filename that disagrees with the headings, and keeps the headings', () => {
    const resolved = resolveDocumentYears({ headingYears: [2025], currentPeriodYear: null }, 'Accounts 2023.pdf', NOW)
    expect(resolved.annualYears).toEqual([2025])
    expect(resolved.source).toBe('heading')
    expect(resolved.conflict).toEqual({ filenameYear: 2023, headingYears: [2025] })
  })

  it('the old first-year rule would have been wrong here; the new one agrees with the heading', () => {
    // "2024-2025" used to read as 2024.
    const resolved = resolveDocumentYears({ headingYears: [2025], currentPeriodYear: null }, '2024-2025_PROFIT_AND_LOSS.pdf', NOW)
    expect(resolved.filename?.year).toBe(2025)
    expect(resolved.conflict).toBeNull()
  })

  it('counts a current-period heading as named, not a conflict', () => {
    const resolved = resolveDocumentYears({ headingYears: [], currentPeriodYear: 2026 }, 'P&L FY26 YTD.pdf', NOW)
    expect(resolved).toMatchObject({ annualYears: [], currentPeriodYear: 2026, source: 'heading', conflict: null })
  })

  it('falls back to the filename when no heading named a year', () => {
    const resolved = resolveDocumentYears({ headingYears: [], currentPeriodYear: null }, 'Balance_sheet_23-24.pdf', NOW)
    expect(resolved).toMatchObject({ annualYears: [2024], source: 'filename', conflict: null })
  })

  it('has nothing to go on with neither', () => {
    const resolved = resolveDocumentYears({ headingYears: [], currentPeriodYear: null }, 'scan.pdf', NOW)
    expect(resolved).toMatchObject({ annualYears: [], source: 'none', filename: null })
  })
})
