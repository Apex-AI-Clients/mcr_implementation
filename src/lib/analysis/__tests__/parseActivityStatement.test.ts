import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { parseActivityStatementCsv } from '../parseActivityStatement'

const fixturePath = join(__dirname, 'fixtures', 'activity_statement_sample.csv')
const fixtureText = readFileSync(fixturePath, 'utf-8')

describe('parseActivityStatementCsv', () => {
  it('extracts statement label and company name from preamble', () => {
    const result = parseActivityStatementCsv(fixtureText)
    expect(result.statementLabel).toBe('Activity statement 002')
    expect(result.companyName).toBe('PARKCON PTY LTD')
  })

  it('returns the correct number of data rows (excluding preamble + header)', () => {
    const result = parseActivityStatementCsv(fixtureText)
    expect(result.rows).toHaveLength(15)
  })

  it('parses dates correctly for the first data row', () => {
    const result = parseActivityStatementCsv(fixtureText)
    const first = result.rows[0]
    expect(first.processedDate).toBeInstanceOf(Date)
    expect(first.effectiveDate).toBeInstanceOf(Date)
    // Use local date parts — toISOString() converts to UTC which shifts the date in non-UTC timezones
    expect(first.processedDate!.getFullYear()).toBe(2026)
    expect(first.processedDate!.getMonth()).toBe(1) // 0-indexed: February
    expect(first.processedDate!.getDate()).toBe(26)
    expect(first.effectiveDate!.getFullYear()).toBe(2026)
    expect(first.effectiveDate!.getMonth()).toBe(2) // 0-indexed: March
    expect(first.effectiveDate!.getDate()).toBe(3)
  })

  it('strips leading apostrophe from description', () => {
    const result = parseActivityStatementCsv(fixtureText)
    expect(result.rows[0].description).toBe(
      'Original Activity Statement for the period ending 31 Dec 25',
    )
    expect(result.rows[0].description.startsWith("'")).toBe(false)
  })

  it('parses currency with $ and comma separators', () => {
    const csv = `"Label"\n"Company"\nProcessed date,Effective date,Description,Debit (DR),Credit (CR),Balance\n01 Jan 2025,01 Jan 2025,Test,"$1,234.56",,`
    const result = parseActivityStatementCsv(csv)
    expect(result.rows[0].debit).toBeCloseTo(1234.56)
    expect(result.rows[0].credit).toBeNull()
    expect(result.rows[0].balance).toBeNull()
  })

  it('handles empty debit and credit cells as null', () => {
    const result = parseActivityStatementCsv(fixtureText)
    // Row 2: PAYG Withholding — debit is empty, credit has a value
    const row2 = result.rows[2]
    expect(row2.debit).toBeNull()
    expect(row2.credit).toBeCloseTo(500.0)
  })

  it('parses DR balance as positive', () => {
    const csv = `"Label"\n"Company"\nProcessed date,Effective date,Description,Debit (DR),Credit (CR),Balance\n01 Jan 2025,01 Jan 2025,Test,,,"$1,234.56 DR"`
    const result = parseActivityStatementCsv(csv)
    expect(result.rows[0].balance).toBeCloseTo(1234.56)
  })

  it('parses CR balance as negative', () => {
    const csv = `"Label"\n"Company"\nProcessed date,Effective date,Description,Debit (DR),Credit (CR),Balance\n01 Jan 2025,01 Jan 2025,Test,,,"$2,500.00 CR"`
    const result = parseActivityStatementCsv(csv)
    expect(result.rows[0].balance).toBeCloseTo(-2500.0)
  })

  it('throws on malformed preamble', () => {
    const bad = `col1,col2,col3\n"Company"\nProcessed date,Effective date,Description,Debit (DR),Credit (CR),Balance\n01 Jan 2025,01 Jan 2025,Test,,,`
    expect(() => parseActivityStatementCsv(bad)).toThrow('Unexpected CSV preamble')
  })

  it('throws on wrong header columns', () => {
    const bad = `"Label"\n"Company"\nDate,Effective date,Description,Debit (DR),Credit (CR),Balance\n01 Jan 2025,01 Jan 2025,Test,,,`
    expect(() => parseActivityStatementCsv(bad)).toThrow('Unexpected CSV header')
  })

  it('sets processedDate to null when cell is empty (no throw)', () => {
    const csv = `"Label"\n"Company"\nProcessed date,Effective date,Description,Debit (DR),Credit (CR),Balance\n,01 Jan 2025,Test,,,`
    const result = parseActivityStatementCsv(csv)
    expect(result.rows[0].processedDate).toBeNull()
  })

  it('reads the Balance column of a CRLF export (as the ATO exports them)', () => {
    // Synthetic rows. With CRLF endings the last cell used to keep its closing
    // quote, so every balance read as null.
    const csv = [
      '"Activity statement 001"',
      '"SAMPLE PTY LTD"',
      'Processed date,Effective date,Description,Debit (DR),Credit (CR),Balance',
      '"26 Sep 2026","26 Sep 2026","General interest charge","$100.00","","$50,000.00 DR"',
      '"10 Sep 2026","10 Sep 2026","Payment received","","$1,000.00","$49,900.00 DR"',
      '"01 Aug 2026","01 Aug 2026","Refund","","$75.50","$1,200.00 CR"',
    ].join('\r\n')
    const rows = parseActivityStatementCsv(csv).rows
    expect(rows.map((r) => r.balance)).toEqual([50_000, 49_900, -1_200])
    expect(rows.map((r) => r.debit)).toEqual([100, null, null])
    expect(rows[2].credit).toBe(75.5)
  })
})
