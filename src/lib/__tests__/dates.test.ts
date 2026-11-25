import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { dateField, dateText, dateTimeText, dayMonthText, isoFromTyped, monthYearText } from '../dates'

/** Australian dates everywhere (Gabby, 24 Nov 2026): DD/MM/YYYY in fields, "19 Nov 2026" in text. */

const US_STYLE = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.? \d{1,2}, \d{4}\b|\b(0?[1-9]|1[0-2])\/(1[3-9]|2\d|3[01])\/\d{4}\b/

describe('dates', () => {
  it('fields are DD/MM/YYYY, text is "19 Nov 2026", never month first', () => {
    const outputs = [
      dateField('2026-11-19'),
      dateText('2026-11-19'),
      monthYearText('2026-11-19'),
      dayMonthText('2026-11-19'),
      dateTimeText('2026-11-19T04:04:00Z'),
      dateText('2026-09-02'),
    ]
    expect(outputs).toEqual(['19/11/2026', '19 Nov 2026', 'Nov 2026', '19 Nov', '19 Nov 2026, 3:04 pm', '2 Sep 2026'])
    for (const out of outputs) expect(out, out).not.toMatch(US_STYLE)
  })

  it('a date-only value is that day anywhere; a moment is the day in Sydney', () => {
    expect(dateText('2026-06-30')).toBe('30 Jun 2026')
    // 2:00 pm UTC on 30 Jun is 12:00 am on 1 Jul in Sydney.
    expect(dateText('2026-06-30T14:00:00Z')).toBe('1 Jul 2026')
    expect(dateField(new Date('2026-06-30T14:00:00Z'))).toBe('01/07/2026')
    expect(dateText('19/11/2026')).toBe('19 Nov 2026')
  })

  it('nothing to show for no date or not a date', () => {
    for (const v of [null, undefined, '', 'Unsure', '2026-02-30']) {
      expect(dateText(v)).toBe('')
      expect(dateField(v)).toBe('')
    }
  })

  it('reads a typed date, DD/MM/YYYY or ISO', () => {
    expect(isoFromTyped('19/11/2026')).toBe('2026-11-19')
    expect(isoFromTyped('1/7/2026')).toBe('2026-07-01')
    expect(isoFromTyped('2026-11-19')).toBe('2026-11-19')
    expect(isoFromTyped('11/19/2026')).toBeNull()
    expect(isoFromTyped('19 Nov')).toBeNull()
  })
})

/** Source files the app ships (not tests). */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name)
    if (statSync(p).isDirectory()) return name === '__tests__' ? [] : sources(p)
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : []
  })
}

describe('no US-style date output anywhere in the app', () => {
  const files = sources(path.resolve(__dirname, '../..'))
  const read = (f: string) => readFileSync(f, 'utf8')

  it('formats dates only in en-AU (en-CA only for internal YYYY-MM-DD keys)', () => {
    const offenders = files.filter((f) => /['"]en-US['"]|toLocaleDateString\(\s*\)|toLocaleDateString\(\s*undefined/.test(read(f)))
    expect(offenders).toEqual([])
  })

  it('has no month-first date pattern (date-fns "MMM d, yyyy" / "MM/dd/yyyy")', () => {
    const offenders = files.filter((f) => /['"`](MMM+ d+,? y+|MM\/dd\/y+|M\/d\/y+)['"`]/.test(read(f)))
    expect(offenders).toEqual([])
  })

  it('shows no date with a bare <input type="date"> (the browser shows it month-first on a US machine)', () => {
    const offenders = files.filter((f) => /type=["']date["']/.test(read(f)) && !f.endsWith(`${path.sep}DateInput.tsx`))
    expect(offenders).toEqual([])
  })
})
