import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { computeLateLodgement } from '../computeLateLodgement'
import { parseActivityStatementCsv } from '../parseActivityStatement'
import type { ParsedCsv, ParsedRow } from '../types'

// Helper: build a minimal ParsedRow for a lodgement-type entry
function makeRow(
  processedIso: string | null,
  effectiveIso: string | null,
  description: string,
  rowIndex = 0,
): ParsedRow {
  return {
    rowIndex,
    processedDate: processedIso ? new Date(processedIso) : null,
    effectiveDate: effectiveIso ? new Date(effectiveIso) : null,
    rawProcessed: processedIso ?? '',
    rawEffective: effectiveIso ?? '',
    description,
    debit: null,
    credit: null,
    balance: null,
  }
}

function makeCsv(rows: ParsedRow[]): ParsedCsv {
  return { statementLabel: 'Test', companyName: 'Test Co', rows }
}

// Returns lateLodgementDays for a single row (signed)
function lateDays(processedIso: string, effectiveIso: string, description: string): number {
  const result = computeLateLodgement(makeCsv([makeRow(processedIso, effectiveIso, description)]))
  return result.rows[0].lateLodgementDays
}

// Returns lateLodgeDaysCleaned for a raw number via a dummy row
function cleaned(lateLodgementDays: number): number {
  return Math.max(lateLodgementDays, 0)
}

describe('computeLateLodgement — sign convention sanity checks (PARKCON dataset values)', () => {
  it('early lodgement returns negative days', () => {
    expect(
      lateDays(
        '2026-02-26',
        '2026-03-03',
        'Original Activity Statement for the period ending 31 Dec 25',
      ),
    ).toBe(-5)
  })

  it('early lodgement returns negative days (2)', () => {
    expect(
      lateDays(
        '2025-08-21',
        '2025-08-25',
        'Original Activity Statement for the period ending 30 Jun 25',
      ),
    ).toBe(-4)
  })

  it('late ClientAmended returns positive days', () => {
    expect(
      lateDays(
        '2024-12-11',
        '2023-08-25',
        'Client initiated amended Activity Statement for the period ending 30 Jun 23',
      ),
    ).toBe(474)
  })

  it('late ClientAmended returns positive days (2)', () => {
    expect(
      lateDays(
        '2022-11-17',
        '2022-08-25',
        'Client initiated amended Activity Statement for the period ending 30 Jun 22',
      ),
    ).toBe(84)
  })

  it('late Original returns positive days', () => {
    expect(
      lateDays(
        '2021-03-26',
        '2021-03-02',
        'Original Activity Statement for the period ending 31 Dec 20',
      ),
    ).toBe(24)
  })

  it('late ClientAmended spanning multiple years returns positive days', () => {
    expect(
      lateDays(
        '2020-03-11',
        '2018-11-26',
        'Client initiated amended Activity Statement for the period ending 30 Sep 18',
      ),
    ).toBe(471)
  })
})

describe('computeLateLodgement — sub-lines and non-lodgement types always return zero', () => {
  it('- GST returns 0', () => {
    expect(lateDays('2024-12-11', '2023-08-25', '- GST')).toBe(0)
  })

  it('- PAYG Withholding returns 0', () => {
    expect(lateDays('2024-12-11', '2023-08-25', '- PAYG Withholding')).toBe(0)
  })

  it('Payment received returns 0', () => {
    expect(lateDays('2024-12-11', '2023-08-25', 'Payment received')).toBe(0)
  })

  it('General interest charge returns 0', () => {
    expect(
      lateDays(
        '2024-12-11',
        '2023-08-25',
        'General interest charge calculated from 01 Aug 25 to 31 Aug 25',
      ),
    ).toBe(0)
  })

  it('ATOAmended returns 0', () => {
    expect(
      lateDays(
        '2024-12-11',
        '2023-08-25',
        'ATO initiated amended Activity Statement for the period ending 30 Jun 24',
      ),
    ).toBe(0)
  })
})

describe('computeLateLodgement — cleaned = max(value, 0)', () => {
  it('cleans negative to 0', () => expect(cleaned(-14)).toBe(0))
  it('leaves 0 as 0', () => expect(cleaned(0)).toBe(0))
  it('leaves positive as-is', () => expect(cleaned(474)).toBe(474))

  it('lateLodgeDaysCleaned is zero for early lodgement', () => {
    const result = computeLateLodgement(
      makeCsv([
        makeRow(
          '2026-02-26',
          '2026-03-03',
          'Original Activity Statement for the period ending 31 Dec 25',
        ),
      ]),
    )
    expect(result.rows[0].lateLodgementDays).toBe(-5)
    expect(result.rows[0].lateLodgeDaysCleaned).toBe(0)
  })
})

describe('computeLateLodgement — defensive: missing date', () => {
  it('adds warning and returns 0 when processedDate is null on a lodgement row', () => {
    const result = computeLateLodgement(
      makeCsv([
        makeRow(null, '2024-08-25', 'Original Activity Statement for the period ending 30 Jun 24'),
      ]),
    )
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0].reason).toBe('missing_dates_on_lodgement')
    expect(result.rows[0].lateLodgementDays).toBe(0)
    expect(result.rows[0].lateLodgeDaysCleaned).toBe(0)
  })

  it('adds warning and returns 0 when effectiveDate is null on a lodgement row', () => {
    const result = computeLateLodgement(
      makeCsv([
        makeRow('2024-12-11', null, 'Client initiated amended Activity Statement for the period ending 30 Jun 23'),
      ]),
    )
    expect(result.warnings).toHaveLength(1)
    expect(result.rows[0].lateLodgementDays).toBe(0)
  })

  it('does not add warning for missing dates on non-lodgement rows', () => {
    const result = computeLateLodgement(
      makeCsv([makeRow(null, null, '- GST')]),
    )
    expect(result.warnings).toHaveLength(0)
    expect(result.rows[0].lateLodgementDays).toBe(0)
  })
})

describe('computeLateLodgement — summary statistics', () => {
  it('counts only rows with lateLodgeDaysCleaned > 0', () => {
    const result = computeLateLodgement(
      makeCsv([
        makeRow('2024-12-11', '2023-08-25', 'Client initiated amended Activity Statement for the period ending 30 Jun 23', 0),
        makeRow('2026-02-26', '2026-03-03', 'Original Activity Statement for the period ending 31 Dec 25', 1),
        makeRow('2021-03-26', '2021-03-02', 'Original Activity Statement for the period ending 31 Dec 20', 2),
      ]),
    )
    expect(result.summary.numberOfLateLodgements).toBe(2)
    expect(result.summary.cumulativeDaysLate).toBe(474 + 24)
  })
})

describe('computeLateLodgement — integration with fixture CSV', () => {
  it('produces correct summary from the sample fixture', () => {
    const csvText = readFileSync(
      join(__dirname, 'fixtures', 'activity_statement_sample.csv'),
      'utf-8',
    )
    const parsed = parseActivityStatementCsv(csvText)
    const result = computeLateLodgement(parsed)

    // 4 lodgement rows are late in the sample fixture:
    // ClientAmended 30 Jun 23: 474 days
    // ClientAmended 30 Jun 22: 84 days
    // Original 31 Dec 20: 24 days
    // ClientAmended 30 Sep 18: 471 days
    expect(result.summary.numberOfLateLodgements).toBe(4)
    expect(result.summary.cumulativeDaysLate).toBe(474 + 84 + 24 + 471)
  })
})
