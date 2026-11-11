import { describe, it, expect } from 'vitest'
import { parseActivityStatementCsv, parseAtoDate } from '../parseActivityStatement'
import { computeLateLodgement } from '../computeLateLodgement'
import { unparsedDateRows, unparsedDatesMessage } from '../config'

/**
 * Dates in an ATO account CSV as the ATO writes them and as Excel or Google
 * Sheets re-save them. A file re-saved in Excel ("20-Oct-26") used to read no
 * date at all, so every lodgement counted as on time and nothing said so.
 * Synthetic rows only.
 */

/** The calendar day a parsed date falls on (the parser returns local midnight). */
const day = (d: Date | null) =>
  d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : null

describe('parseAtoDate', () => {
  it.each([
    ['20 Oct 2026', 'the ATO download'],
    ['20-Oct-26', 'Excel re-save, two-digit year'],
    ['20-Oct-2026', 'Excel, four-digit year'],
    ['20/10/2026', 'Excel / Sheets, Australian short date'],
    ['20/10/26', 'Australian short date, two-digit year'],
    ['2026-10-20', 'ISO'],
    ['46315', 'Excel serial number'],
  ])('reads %s (%s) as 20 October 2026', (raw) => {
    expect(day(parseAtoDate(raw))).toBe('2026-10-20')
  })

  it('reads single-digit days and months', () => {
    expect(day(parseAtoDate('6-Oct-26'))).toBe('2026-10-06')
    expect(day(parseAtoDate('1 Jul 2025'))).toBe('2025-07-01')
    expect(day(parseAtoDate('6/1/2026'))).toBe('2026-01-06')
    expect(day(parseAtoDate('2026-1-6'))).toBe('2026-01-06')
  })

  it('is day-first: 01/02/2026 is 1 February, never 2 January', () => {
    expect(day(parseAtoDate('01/02/2026'))).toBe('2026-02-01')
    expect(day(parseAtoDate('12/11/26'))).toBe('2026-11-12')
  })

  it('never reads a US month-first date', () => {
    // 10/20/2026 would be 20 October in the US; there is no month 20 here.
    expect(parseAtoDate('10/20/2026')).toBeNull()
    expect(parseAtoDate('10/20/26')).toBeNull()
    expect(parseAtoDate('Oct 20, 2026')).toBeNull()
  })

  it('reads two-digit years as 20YY', () => {
    expect(day(parseAtoDate('30-Jun-99'))).toBe('2099-06-30')
    expect(day(parseAtoDate('28-Jul-03'))).toBe('2003-07-28')
    expect(day(parseAtoDate('28/07/03'))).toBe('2003-07-28')
  })

  it('reads Excel serial numbers', () => {
    expect(day(parseAtoDate('45108'))).toBe('2023-07-01')
    expect(day(parseAtoDate('45473'))).toBe('2024-06-30')
    expect(day(parseAtoDate('46315.0'))).toBe('2026-10-20')
    // Out of range: not a date in an account history.
    expect(parseAtoDate('12345')).toBeNull()
    expect(parseAtoDate('99999')).toBeNull()
  })

  it('reads month names in any case, full or short', () => {
    expect(day(parseAtoDate('20 OCT 2026'))).toBe('2026-10-20')
    expect(day(parseAtoDate('20 October 2026'))).toBe('2026-10-20')
    expect(day(parseAtoDate('20-Sept-26'))).toBe('2026-09-20')
  })

  it('ignores a midnight time and stray quotes or apostrophes', () => {
    expect(day(parseAtoDate('20/10/2026 0:00'))).toBe('2026-10-20')
    expect(day(parseAtoDate('2026-10-20T00:00:00.000Z'))).toBe('2026-10-20')
    expect(day(parseAtoDate("'20 Oct 2026"))).toBe('2026-10-20')
    expect(day(parseAtoDate(' "20-Oct-26" '))).toBe('2026-10-20')
  })

  it('refuses days that do not exist and anything else', () => {
    expect(parseAtoDate('31 Feb 2026')).toBeNull()
    expect(parseAtoDate('29-Feb-25')).toBeNull()
    expect(parseAtoDate('29-Feb-24')).not.toBeNull()
    expect(parseAtoDate('32/01/2026')).toBeNull()
    expect(parseAtoDate('20 Foo 2026')).toBeNull()
    expect(parseAtoDate('2026')).toBeNull()
    expect(parseAtoDate('')).toBeNull()
    expect(parseAtoDate('   ')).toBeNull()
    expect(parseAtoDate('#######')).toBeNull()
  })
})

const HEADER = '"Activity statement 001"\n"SAMPLE TRADING PTY LTD"\nProcessed date,Effective date,Description,Debit (DR),Credit (CR),Balance\n'

/** One late original (30 days), one late client amendment (10 days) and a payment, with the dates written as `fmt` writes them. */
function csv(fmt: (y: number, m: number, d: number) => string): string {
  return (
    HEADER +
    [
      `${fmt(2026, 10, 20)},${fmt(2026, 10, 19)},Payment received,,"$500.00","$9,500.00 DR"`,
      `${fmt(2026, 9, 27)},${fmt(2026, 9, 17)},Client initiated amended Activity Statement for the period ending 30 Jun 26 - GST,"$2,000.00",,"$10,000.00 DR"`,
      `${fmt(2026, 3, 30)},${fmt(2026, 2, 28)},Original Activity Statement for the period ending 31 Dec 25 - GST,"$8,000.00",,"$8,000.00 DR"`,
    ].join('\n') +
    '\n'
  )
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const pad = (n: number) => String(n).padStart(2, '0')
const FORMATS: Record<string, (y: number, m: number, d: number) => string> = {
  ato: (y, m, d) => `${pad(d)} ${MON[m - 1]} ${y}`,
  'excel d-mmm-yy': (y, m, d) => `${d}-${MON[m - 1]}-${String(y).slice(2)}`,
  'excel d-mmm-yyyy': (y, m, d) => `${d}-${MON[m - 1]}-${y}`,
  'dd/mm/yyyy': (y, m, d) => `${pad(d)}/${pad(m)}/${y}`,
  'dd/mm/yy': (y, m, d) => `${pad(d)}/${pad(m)}/${String(y).slice(2)}`,
  iso: (y, m, d) => `${y}-${pad(m)}-${pad(d)}`,
  'excel serial': (y, m, d) => String(Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000)),
}

describe('the analysis of a re-saved export', () => {
  it.each(Object.keys(FORMATS))('gives the same figures for dates written as %s', (name) => {
    const ato = computeLateLodgement(parseActivityStatementCsv(csv(FORMATS.ato)), 'originals_and_amendments')
    const r = computeLateLodgement(parseActivityStatementCsv(csv(FORMATS[name])), 'originals_and_amendments')
    expect(r.unparsedDateRows).toBe(0)
    expect(r.summary).toEqual({ numberOfLateLodgements: 2, cumulativeDaysLate: 40 })
    expect(r.summary).toEqual(ato.summary)
    expect(r.debtBreakdown.atoBalanceDate).toBe('2026-10-20')
    expect(computeLateLodgement(parseActivityStatementCsv(csv(FORMATS[name])), 'originals_only').summary).toEqual({
      numberOfLateLodgements: 1,
      cumulativeDaysLate: 30,
    })
  })

  it('counts rows whose dates cannot be read, instead of reading them as on time', () => {
    // US order: 03/30/2026 has no month 30.
    const us = csv((y, m, d) => `${pad(m)}/${pad(d)}/${y}`)
    const r = computeLateLodgement(parseActivityStatementCsv(us))
    expect(r.unparsedDateRows).toBeGreaterThan(0)
  })

  it('counts a single unreadable or blank date', () => {
    const one = HEADER + '20 Oct 2026,19 Oct 2026,Payment received,,"$1.00","$1.00 DR"\n' + '20 Oct 2026,,General interest charge,"$1.00",,"$2.00 DR"\n' + '??,20 Oct 2026,General interest charge,"$1.00",,"$3.00 DR"\n'
    expect(computeLateLodgement(parseActivityStatementCsv(one)).unparsedDateRows).toBe(2)
  })

  it('counts unread dates in stored rows too (dates saved as null)', () => {
    expect(unparsedDateRows([{ processedDate: '2026-10-20T00:00:00.000Z', effectiveDate: '2026-10-19T00:00:00.000Z' }])).toBe(0)
    expect(unparsedDateRows([{ processedDate: null, effectiveDate: null }, { processedDate: '2026-10-20', effectiveDate: null }])).toBe(2)
    expect(unparsedDateRows(null)).toBe(0)
  })

  it('says what went wrong and what to do', () => {
    expect(unparsedDatesMessage(630)).toBe(
      "We couldn't read the dates on 630 rows of this file — was it edited in Excel? Upload the original ATO download.",
    )
    expect(unparsedDatesMessage(1)).toContain('on 1 row of this file')
  })
})
