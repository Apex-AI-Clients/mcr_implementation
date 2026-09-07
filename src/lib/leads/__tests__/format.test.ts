import { describe, it, expect } from 'vitest'
import {
  formatDebtRange,
  overlapsFloor,
  compareByDebtDesc,
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
import { DEBT_PRESETS } from '../constants'
import type { Lead } from '@/types/leads'

const NOW = new Date('2026-09-01T02:00:00.000Z') // midday in Sydney

function makeLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: 'ld_test',
    name: 'Test Lead',
    email: 'test@example.com.au',
    phone: '0402915338',
    debtMin: 100_000,
    debtMax: 124_999,
    entityType: 'company',
    message: null,
    preferredCallTime: null,
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

describe('formatDebtRange', () => {
  it('renders both-null as an em dash, never a blank', () => {
    expect(formatDebtRange(null, null)).toBe('\u2014')
    expect(formatDebtRange(null, null, 'full')).toBe('\u2014')
  })

  it('renders an open-ended range with a plus', () => {
    // The website form only offers "$150,000 or +" — it must not be shown as a
    // closed bracket it never claimed.
    expect(formatDebtRange(150_000, null)).toBe('$150k+')
    expect(formatDebtRange(150_000, null, 'full')).toBe('$150,000+')
    expect(formatDebtRange(500_000, null)).toBe('$500k+')
  })

  it('renders a closed range', () => {
    expect(formatDebtRange(100_000, 124_999)).toBe('$100k \u2013 $125k')
    expect(formatDebtRange(100_000, 124_999, 'full')).toBe('$100,000 \u2013 $124,999')
    expect(formatDebtRange(250_000, 500_000)).toBe('$250k \u2013 $500k')
  })

  it('renders a single typed figure as one amount, not a degenerate range', () => {
    // A free-text debt field produces min === max; "$120k – $120k" would look
    // like a bug.
    expect(formatDebtRange(120_000, 120_000)).toBe('$120k')
    expect(formatDebtRange(45_000, 45_000, 'full')).toBe('$45,000')
  })

  it('renders a zero or unknown floor as "Under"', () => {
    expect(formatDebtRange(0, 49_999)).toBe('Under $50k')
    expect(formatDebtRange(0, 49_999, 'full')).toBe('Under $49,999')
    expect(formatDebtRange(null, 49_999)).toBe('Under $50k')
  })

  it('abbreviates to the nearest thousand in short form', () => {
    expect(formatDebtRange(125_000, 149_999)).toBe('$125k \u2013 $150k')
  })

  it('formats every preset without throwing', () => {
    for (const preset of DEBT_PRESETS) {
      expect(typeof formatDebtRange(preset.min, preset.max)).toBe('string')
      expect(formatDebtRange(preset.min, preset.max)).not.toBe('')
    }
  })
})

describe('overlapsFloor', () => {
  const at = (debtMin: number | null, debtMax: number | null) => ({ debtMin, debtMax })

  it('matches a closed range whose top reaches the floor', () => {
    expect(overlapsFloor(at(100_000, 124_999), 100_000)).toBe(true)
    expect(overlapsFloor(at(100_000, 124_999), 125_000)).toBe(false)
  })

  it('matches an open-ended range at any lower floor', () => {
    // This is the case equality would get wrong: "$150k+" has to show up under
    // $100k+, because it could be anything above $150k.
    expect(overlapsFloor(at(150_000, null), 100_000)).toBe(true)
    expect(overlapsFloor(at(150_000, null), 150_000)).toBe(true)
    expect(overlapsFloor(at(150_000, null), 250_000)).toBe(false)
  })

  it('never matches a lead with no debt recorded', () => {
    expect(overlapsFloor(at(null, null), 50_000)).toBe(false)
  })

  it('puts every preset above its own floor', () => {
    for (const preset of DEBT_PRESETS) {
      if (preset.min === null) continue
      expect(overlapsFloor(at(preset.min, preset.max), preset.min)).toBe(true)
    }
  })
})

describe('compareByDebtDesc', () => {
  it('sorts largest first by min', () => {
    const sorted = [{ debtMin: 100_000 }, { debtMin: 500_000 }, { debtMin: 50_000 }].sort(
      compareByDebtDesc,
    )
    expect(sorted.map((l) => l.debtMin)).toEqual([500_000, 100_000, 50_000])
  })

  it('puts unknown debt last', () => {
    const sorted = [{ debtMin: null }, { debtMin: 100_000 }, { debtMin: null }, { debtMin: 500_000 }]
      .sort(compareByDebtDesc)
    expect(sorted.map((l) => l.debtMin)).toEqual([500_000, 100_000, null, null])
  })

  it('is not alphabetical — $500k outranks $100k', () => {
    // Sorting the labels would put "$100k \u2013 $125k" above "$500k+".
    const sorted = [{ debtMin: 100_000 }, { debtMin: 500_000 }].sort(compareByDebtDesc)
    expect(sorted[0].debtMin).toBe(500_000)
  })

  it('treats two unknowns as equal', () => {
    expect(compareByDebtDesc({ debtMin: null }, { debtMin: null })).toBe(0)
  })
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

  it('formats an Australian mobile as 04xx xxx xxx', () => {
    expect(formatPhone('0402915338')).toBe('0402 915 338')
    expect(formatPhone('+61402915338')).toBe('0402 915 338')
  })

  it.each([
    ['4155550123', '(415) 555-0123'],
    ['14155550123', '(415) 555-0123'],
    ['+14155550123', '(415) 555-0123'],
    ['415-555-0123', '(415) 555-0123'],
    ['(415) 555 0123', '(415) 555-0123'],
  ])('formats %s in US style', (input, expected) => {
    expect(formatPhone(input)).toBe(expected)
  })

  it('never forces US grouping onto an Australian number', () => {
    // "(040) 291-5338" is not a number anyone could dial.
    expect(formatPhone('0402915338')).not.toContain('(')
    expect(formatPhone('0298765432')).not.toContain('(')
  })

  it('returns unrecognised input untouched', () => {
    expect(formatPhone('switchboard')).toBe('switchboard')
    expect(formatPhone('12345')).toBe('12345')
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
      'Date added,Name,Email,Phone,Debt min,Debt max,Entity type,State,Message,Stage,Source,Last action',
    )
    expect(lines[1]).toBe(
      '2026-08-26,Test Lead,test@example.com.au,0402 915 338,100000,124999,Company,VIC,,Lead,Facebook,2026-08-26',
    )
  })

  it('quotes and escapes cells containing commas or quotes', () => {
    const csv = leadsToCsv([
      makeLead({ name: 'Mason, Ellery', email: 'a"b@example.com' }),
    ])
    expect(csv).toContain('"Mason, Ellery"')
    expect(csv).toContain('"a""b@example.com"')
  })

  it('emits debt as two bare numbers so a spreadsheet can sort and filter it', () => {
    const csv = leadsToCsv([makeLead({ debtMin: 250_000, debtMax: 500_000 })])
    expect(csv).toContain(',250000,500000,')
    expect(csv).not.toContain('$')
  })

  it('leaves the max blank for an open-ended range', () => {
    const csv = leadsToCsv([makeLead({ debtMin: 150_000, debtMax: null })])
    expect(csv).toContain(',150000,,')
  })

  it('leaves both blank when no debt was given', () => {
    const csv = leadsToCsv([makeLead({ debtMin: null, debtMax: null })])
    expect(csv).not.toContain('\u2014')
  })

  it('includes the message, quoted when it contains a comma', () => {
    const csv = leadsToCsv([makeLead({ message: 'Behind on PAYG, and GST.' })])
    expect(csv).toContain('"Behind on PAYG, and GST."')
  })

  it('emits the entity type label, blank when unknown', () => {
    expect(leadsToCsv([makeLead({ entityType: 'trust' })])).toContain(',Trust,')
    expect(leadsToCsv([makeLead({ entityType: null })])).toContain(',,')
  })

  it('returns just the header for an empty view', () => {
    expect(leadsToCsv([]).split('\r\n')).toHaveLength(1)
  })
})
