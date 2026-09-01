import { describe, it, expect } from 'vitest'
import {
  formatDebt,
  parseDebtInput,
  normalisePhone,
  isValidAuMobile,
  formatPhone,
  isValidEmail,
  daysBetween,
  formatShortDate,
  formatFullDate,
  formatIsoDate,
  formatAge,
  leadsToCsv,
} from '../format'
import type { Lead } from '@/types/leads'

const NOW = new Date('2026-09-01T02:00:00.000Z') // midday in Sydney

function makeLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: 'ld_test',
    name: 'Test Lead',
    email: 'test@example.com.au',
    phone: '0402915338',
    debtAmount: 4_150_000,
    state: 'VIC',
    stage: 'lead',
    source: 'facebook',
    company: null,
    nextStep: null,
    stageSince: '2026-08-26T00:00:00.000Z',
    lastActionAt: '2026-08-26T00:00:00.000Z',
    convertedClientId: null,
    createdAt: '2026-08-26T00:00:00.000Z',
    updatedAt: '2026-08-26T00:00:00.000Z',
    ...overrides,
  }
}

describe('formatDebt', () => {
  it('formats whole dollars without decimals', () => {
    expect(formatDebt(4_150_000)).toBe('$41,500')
  })

  it('shows cents only when there are any', () => {
    expect(formatDebt(4_150_075)).toBe('$41,500.75')
  })

  it('handles zero and large amounts', () => {
    expect(formatDebt(0)).toBe('$0')
    expect(formatDebt(39_600_000)).toBe('$396,000')
  })
})

describe('parseDebtInput', () => {
  it.each([
    ['41500', 4_150_000],
    ['$41,500', 4_150_000],
    ['  $41,500  ', 4_150_000],
    ['41500.75', 4_150_075],
    ['0.05', 5],
    ['.5', 50],
  ])('parses %s', (input, expected) => {
    expect(parseDebtInput(input)).toBe(expected)
  })

  it('avoids float drift on cents', () => {
    // 41500.55 * 100 is 4150054.999... in binary floating point.
    expect(parseDebtInput('41500.55')).toBe(4_150_055)
    expect(Number.isInteger(parseDebtInput('41500.55'))).toBe(true)
  })

  it.each(['', '   ', 'abc', '-500', '0', '1.2.3', '12abc', '$'])(
    'rejects %s',
    (input) => {
      expect(parseDebtInput(input)).toBeNull()
    },
  )
})

describe('phone', () => {
  it.each([
    ['0402 915 338', '0402915338'],
    ['0402915338', '0402915338'],
    ['+61 402 915 338', '0402915338'],
    ['61402915338', '0402915338'],
    ['(04) 0291-5338', '0402915338'],
  ])('normalises %s', (input, expected) => {
    expect(normalisePhone(input)).toBe(expected)
  })

  it.each(['0402 915 338', '0402915338', '+61 402 915 338'])('accepts %s', (input) => {
    expect(isValidAuMobile(input)).toBe(true)
  })

  it.each(['0302915338', '040291533', '04029153388', '', 'not a phone', '0412-abc-999'])(
    'rejects %s',
    (input) => {
      expect(isValidAuMobile(input)).toBe(false)
    },
  )

  it('formats to 04xx xxx xxx', () => {
    expect(formatPhone('0402915338')).toBe('0402 915 338')
    expect(formatPhone('+61402915338')).toBe('0402 915 338')
  })

  it('returns unrecognised input untouched', () => {
    expect(formatPhone('switchboard')).toBe('switchboard')
  })
})

describe('isValidEmail', () => {
  it.each(['a@b.co', 'marcus.oyelaran@brightpath.com.au', 'x+tag@example.org'])(
    'accepts %s',
    (input) => {
      expect(isValidEmail(input)).toBe(true)
    },
  )

  it.each(['', 'nope', 'a@b', 'a@@b.co', 'a b@c.co', '@b.co', 'a@.co'])(
    'rejects %s',
    (input) => {
      expect(isValidEmail(input)).toBe(false)
    },
  )
})

describe('dates', () => {
  it('counts whole Sydney days', () => {
    expect(daysBetween('2026-09-01T02:00:00.000Z', NOW)).toBe(0)
    expect(daysBetween('2026-08-31T02:00:00.000Z', NOW)).toBe(1)
    expect(daysBetween('2026-08-26T02:00:00.000Z', NOW)).toBe(6)
  })

  it('anchors to Sydney, not the host timezone', () => {
    // 2026-09-01T22:00Z is already 2 Sep in Sydney (UTC+10).
    expect(formatIsoDate('2026-09-01T22:00:00.000Z')).toBe('2026-09-02')
    expect(formatShortDate('2026-09-01T22:00:00.000Z')).toBe('2 Sept')
  })

  it('formats short and full dates', () => {
    expect(formatShortDate('2026-08-26T00:00:00.000Z')).toBe('26 Aug')
    expect(formatFullDate('2026-08-26T00:00:00.000Z')).toBe('26 Aug 2026')
  })

  it.each([
    ['2026-09-01T02:00:00.000Z', 'Today'],
    ['2026-08-31T02:00:00.000Z', 'Yesterday'],
    ['2026-08-29T02:00:00.000Z', '3 days ago'],
  ])('describes the age of %s as %s', (iso, expected) => {
    expect(formatAge(iso, NOW)).toBe(expected)
  })

  it('falls back to a full date past 30 days', () => {
    // en-AU does not abbreviate every month to three letters ("June", "Sept").
    expect(formatAge('2026-06-01T02:00:00.000Z', NOW)).toBe('1 June 2026')
  })
})

describe('leadsToCsv', () => {
  it('emits a header plus one row per lead', () => {
    const csv = leadsToCsv([makeLead()])
    const lines = csv.split('\r\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toBe(
      'Date added,Name,Email,Phone,Debt (AUD),State,Stage,Source,Last action',
    )
    expect(lines[1]).toBe(
      '2026-08-26,Test Lead,test@example.com.au,0402 915 338,41500.00,VIC,Lead,Facebook,2026-08-26',
    )
  })

  it('quotes and escapes cells containing commas or quotes', () => {
    const csv = leadsToCsv([
      makeLead({ name: 'Mason, Ellery', email: 'a"b@example.com' }),
    ])
    expect(csv).toContain('"Mason, Ellery"')
    expect(csv).toContain('"a""b@example.com"')
  })

  it('emits debt as a bare number so a spreadsheet can sum it', () => {
    const csv = leadsToCsv([makeLead({ debtAmount: 39_600_000 })])
    expect(csv).toContain(',396000.00,')
    expect(csv).not.toContain('$')
  })

  it('returns just the header for an empty view', () => {
    expect(leadsToCsv([]).split('\r\n')).toHaveLength(1)
  })
})
