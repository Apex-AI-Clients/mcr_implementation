import { describe, it, expect } from 'vitest'
import {
  checkDirectorPenaltyNotice,
  daysUntil,
  directorNameMatches,
  dpnDeadline,
  rowAddsUp,
} from '../checks'
import type { DpnRow } from '../types'

/** Checks on a parsed notice. Synthetic names and figures only. */

function row(overrides: Partial<DpnRow> = {}): DpnRow {
  return {
    periodFrom: '2025-01-01',
    periodTo: '2025-03-31',
    column2: 1_000_00,
    column3: 900_00,
    column4: 800_00,
    column5: 100_00,
    ...overrides,
  }
}

const NOTICE = { acn: '000000019', directorName: 'MR JANE Q SAMPLE', rows: [row()] }
const FILE = { acn: '000 000 019', directors: [{ name: 'Jane Quinn Sample' }] }

describe('rowAddsUp', () => {
  it('accepts Column 3 = Column 4 + Column 5, to the cent either way', () => {
    expect(rowAddsUp(row())).toBe(true)
    expect(rowAddsUp(row({ column3: 900_01 }))).toBe(true)
    expect(rowAddsUp(row({ column3: 900_02 }))).toBe(false)
  })
})

describe('checkDirectorPenaltyNotice', () => {
  it('raises nothing when the notice agrees with itself and the file', () => {
    expect(checkDirectorPenaltyNotice(NOTICE, FILE)).toEqual([])
  })

  it('names the row that does not add up', () => {
    const notice = { ...NOTICE, rows: [row(), row({ periodFrom: '2024-10-01', periodTo: '2024-12-31', column5: 0 })] }
    expect(checkDirectorPenaltyNotice(notice, FILE)).toEqual([
      { code: 'row_does_not_add_up', rowIndex: 1, periodFrom: '2024-10-01', periodTo: '2024-12-31' },
    ])
  })

  it('warns when the ACN differs from the file, or the file has none', () => {
    expect(checkDirectorPenaltyNotice(NOTICE, { ...FILE, acn: '123 456 780' })).toEqual([
      { code: 'acn_mismatch' },
    ])
    expect(checkDirectorPenaltyNotice(NOTICE, { ...FILE, acn: null })).toEqual([
      { code: 'acn_not_on_file' },
    ])
  })

  it('warns when the ACN fails its check digit', () => {
    const codes = checkDirectorPenaltyNotice({ ...NOTICE, acn: '000000018' }, FILE).map((c) => c.code)
    expect(codes).toContain('acn_invalid')
  })

  it('warns when the director is not on file, or there are none', () => {
    expect(
      checkDirectorPenaltyNotice(NOTICE, { ...FILE, directors: [{ name: 'Raj Example' }] }),
    ).toEqual([{ code: 'director_not_on_file' }])
    expect(checkDirectorPenaltyNotice(NOTICE, { ...FILE, directors: [] })).toEqual([
      { code: 'no_directors_on_file' },
    ])
  })
})

describe('directorNameMatches', () => {
  it.each([
    ['MR JANE Q SAMPLE', 'Jane Quinn Sample'],
    ['MR JANE Q SAMPLE', 'jane sample'],
    ['MS J SAMPLE', 'Jane Sample'],
    ["DR MEI O'EXAMPLE", "Mei O'Example"],
  ])('matches %s with %s', (a, b) => {
    expect(directorNameMatches(a, b)).toBe(true)
  })

  it.each([
    ['MR JANE Q SAMPLE', 'Jane Example'],
    ['MR JANE Q SAMPLE', 'Raj Sample'],
    ['', 'Jane Sample'],
  ])('does not match %s with %s', (a, b) => {
    expect(directorNameMatches(a, b)).toBe(false)
  })
})

describe('dpnDeadline and daysUntil', () => {
  it('is the date of issue plus 21 days', () => {
    expect(dpnDeadline('2026-09-30')).toBe('2026-10-21')
    expect(dpnDeadline('2026-12-20')).toBe('2027-01-10')
  })

  it('counts whole days, 0 on the day and negative after', () => {
    expect(daysUntil('2026-10-21', '2026-10-14')).toBe(7)
    expect(daysUntil('2026-10-21', '2026-10-21')).toBe(0)
    expect(daysUntil('2026-10-21', '2026-10-23')).toBe(-2)
  })
})
