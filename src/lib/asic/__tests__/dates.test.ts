import { describe, it, expect } from 'vitest'
import {
  dobFromBornValue,
  formatDob,
  formatExtractDate,
  isIsoDob,
  parseDobInput,
  parseExtractDateTime,
} from '../dates'

const NOW = new Date('2026-09-30T00:00:00Z')

describe('parseDobInput', () => {
  it('takes DD/MM/YYYY, MM/YYYY and YYYY', () => {
    expect(parseDobInput('14/03/1970', NOW)).toEqual({ ok: true, iso: '1970-03-14' })
    expect(parseDobInput('4/3/1970', NOW)).toEqual({ ok: true, iso: '1970-03-04' })
    expect(parseDobInput('03/1970', NOW)).toEqual({ ok: true, iso: '1970-03' })
    expect(parseDobInput('1970', NOW)).toEqual({ ok: true, iso: '1970' })
  })

  it('allows blank, meaning not known', () => {
    expect(parseDobInput('', NOW)).toEqual({ ok: true, iso: null })
    expect(parseDobInput('   ', NOW)).toEqual({ ok: true, iso: null })
  })

  it('rejects dates that do not exist', () => {
    expect(parseDobInput('31/02/1970', NOW).ok).toBe(false)
    expect(parseDobInput('29/02/1971', NOW).ok).toBe(false)
    expect(parseDobInput('29/02/1972', NOW)).toEqual({ ok: true, iso: '1972-02-29' })
    expect(parseDobInput('13/1970', NOW).ok).toBe(false)
  })

  it('rejects years nobody alive was born in, and the future', () => {
    expect(parseDobInput('1899', NOW).ok).toBe(false)
    expect(parseDobInput('2027', NOW).ok).toBe(false)
    expect(parseDobInput('2026', NOW).ok).toBe(true)
  })

  it('rejects anything else, with the formats in the message', () => {
    const result = parseDobInput('March 1970', NOW)
    expect(result).toEqual({ ok: false, message: 'Use DD/MM/YYYY, MM/YYYY or YYYY.' })
    expect(parseDobInput('1970-03-14', NOW).ok).toBe(false)
  })
})

describe('formatDob / isIsoDob', () => {
  it('round-trips every precision', () => {
    for (const shown of ['14/03/1970', '03/1970', '1970']) {
      const parsed = parseDobInput(shown, NOW)
      if (!parsed.ok || !parsed.iso) throw new Error('expected a date')
      expect(isIsoDob(parsed.iso)).toBe(true)
      expect(formatDob(parsed.iso)).toBe(shown)
    }
  })

  it('shows nothing for a missing date', () => {
    expect(formatDob(null)).toBe('')
    expect(formatDob('')).toBe('')
  })

  it('rejects stored values that are not one of the three shapes', () => {
    expect(isIsoDob('14/03/1970')).toBe(false)
    expect(isIsoDob('1970-13')).toBe(false)
    expect(isIsoDob('1970-02-30')).toBe(false)
  })
})

describe('dobFromBornValue', () => {
  it('keeps the date and drops the place and country', () => {
    expect(dobFromBornValue('14/03/1970, BIRTHVILLE, VIC')).toBe('1970-03-14')
    expect(dobFromBornValue('14/03/1970 BIRTHVILLE VIC')).toBe('1970-03-14')
  })

  it('takes the shorter forms ASIC may move to', () => {
    expect(dobFromBornValue('1970, BIRTHVILLE, VIC')).toBe('1970')
    expect(dobFromBornValue('03/1970, BIRTHVILLE')).toBe('1970-03')
  })

  it('is null without a usable date', () => {
    expect(dobFromBornValue('BIRTHVILLE, VIC')).toBeNull()
    expect(dobFromBornValue('')).toBeNull()
    expect(dobFromBornValue('31/02/1970, BIRTHVILLE')).toBeNull()
  })
})

describe('parseExtractDateTime', () => {
  it("reads the cover's Date/Time with its zone", () => {
    expect(parseExtractDateTime('23 September 2026 AEST 02:07:38 PM')).toBe(
      '2026-09-23T14:07:38+10:00',
    )
    expect(parseExtractDateTime('5 January 2027 AEDT 09:15:00 AM')).toBe('2027-01-05T09:15:00+11:00')
    expect(parseExtractDateTime('23 September 2026 AEST 12:30:00 AM')).toBe(
      '2026-09-23T00:30:00+10:00',
    )
  })

  it('assumes AEST without a zone, and midnight without a time', () => {
    expect(parseExtractDateTime('23 September 2026')).toBe('2026-09-23T00:00:00+10:00')
  })

  it('is null when there is no date', () => {
    expect(parseExtractDateTime('sometime')).toBeNull()
    expect(parseExtractDateTime('31 February 2026 AEST')).toBeNull()
  })
})

describe('formatExtractDate', () => {
  it("shows the extract's own calendar date", () => {
    expect(formatExtractDate('2026-09-23T14:07:38+10:00')).toBe('23 September 2026')
    expect(formatExtractDate(null)).toBe('')
  })
})
