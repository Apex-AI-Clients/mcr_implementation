import { describe, it, expect } from 'vitest'
import {
  DOB_FORMAT_MESSAGE,
  DOB_FUTURE_MESSAGE,
  formatDob,
  normaliseIsoDob,
  parseDob,
} from '../dob'

/**
 * Dates of birth at three precisions. The rule that matters most: a value is
 * never made more precise than it was — "1970" must not become 1 January.
 */

const NOW = new Date('2026-09-29T00:00:00Z')

const ok = (iso: string) => ({ kind: 'ok', iso })
const invalid = (message = DOB_FORMAT_MESSAGE) => ({ kind: 'invalid', message })

describe('parseDob', () => {
  it('accepts DD/MM/YYYY, day first', () => {
    expect(parseDob('05/06/1970', NOW)).toEqual(ok('1970-06-05'))
    expect(parseDob('5/6/1970', NOW)).toEqual(ok('1970-06-05'))
  })

  it('accepts MM/YYYY and YYYY without padding them out', () => {
    expect(parseDob('11/1982', NOW)).toEqual(ok('1982-11'))
    expect(parseDob('3/1982', NOW)).toEqual(ok('1982-03'))
    expect(parseDob('1990', NOW)).toEqual(ok('1990'))
  })

  it('accepts other separators and surrounding space', () => {
    expect(parseDob(' 05-06-1970 ', NOW)).toEqual(ok('1970-06-05'))
    expect(parseDob('05.06.1970', NOW)).toEqual(ok('1970-06-05'))
    expect(parseDob('05 06 1970', NOW)).toEqual(ok('1970-06-05'))
  })

  it('accepts an ISO date pasted in, at any precision', () => {
    expect(parseDob('1970-06-05', NOW)).toEqual(ok('1970-06-05'))
    expect(parseDob('1970-06', NOW)).toEqual(ok('1970-06'))
  })

  it('treats blank as empty, which is allowed', () => {
    expect(parseDob('', NOW)).toEqual({ kind: 'empty' })
    expect(parseDob('   ', NOW)).toEqual({ kind: 'empty' })
  })

  it('refuses dates that do not exist', () => {
    expect(parseDob('30/02/1970', NOW)).toEqual(invalid())
    expect(parseDob('31/04/1970', NOW)).toEqual(invalid())
    expect(parseDob('13/1970', NOW)).toEqual(invalid())
    expect(parseDob('00/05/1970', NOW)).toEqual(invalid())
  })

  it('knows about leap years', () => {
    expect(parseDob('29/02/1972', NOW)).toEqual(ok('1972-02-29'))
    expect(parseDob('29/02/1971', NOW)).toEqual(invalid())
  })

  it('refuses things that are not dates', () => {
    for (const value of ['abc', '1970/05/01', '5/1970/1', '19700', '70', '1/2/70']) {
      expect(parseDob(value, NOW)).toEqual(invalid())
    }
  })

  it('refuses years before 1900', () => {
    expect(parseDob('1899', NOW)).toEqual(invalid())
  })

  it('refuses the future, compared at the precision given', () => {
    expect(parseDob('30/09/2026', NOW)).toEqual(invalid(DOB_FUTURE_MESSAGE))
    expect(parseDob('10/2026', NOW)).toEqual(invalid(DOB_FUTURE_MESSAGE))
    expect(parseDob('2970', NOW)).toEqual(invalid(DOB_FUTURE_MESSAGE))
    // This month and this year are not the future.
    expect(parseDob('09/2026', NOW)).toEqual(ok('2026-09'))
    expect(parseDob('2026', NOW)).toEqual(ok('2026'))
  })
})

describe('normaliseIsoDob', () => {
  it('accepts the three ISO precisions', () => {
    expect(normaliseIsoDob('1970-05-01')).toBe('1970-05-01')
    expect(normaliseIsoDob('1970-05')).toBe('1970-05')
    expect(normaliseIsoDob('1970')).toBe('1970')
  })

  it('drops a trailing time', () => {
    expect(normaliseIsoDob('1970-05-01T00:00:00Z')).toBe('1970-05-01')
  })

  it('answers null for anything else', () => {
    for (const value of [null, undefined, 42, '', '01/05/1970', '1970-02-30', '1970-13', 'soon']) {
      expect(normaliseIsoDob(value)).toBeNull()
    }
  })
})

describe('formatDob', () => {
  it('shows each precision the way it is typed', () => {
    expect(formatDob('1970-05-01')).toBe('01/05/1970')
    expect(formatDob('1970-05')).toBe('05/1970')
    expect(formatDob('1970')).toBe('1970')
  })

  it('shows nothing for a missing date', () => {
    expect(formatDob(null)).toBe('')
    expect(formatDob(undefined)).toBe('')
    expect(formatDob('')).toBe('')
  })

  it('shows an unrecognised value as it is, so it can be fixed', () => {
    expect(formatDob('sometime')).toBe('sometime')
  })

  it('round-trips through parseDob', () => {
    for (const iso of ['1970-05-01', '1982-11', '1990']) {
      expect(parseDob(formatDob(iso), NOW)).toEqual(ok(iso))
    }
  })
})
