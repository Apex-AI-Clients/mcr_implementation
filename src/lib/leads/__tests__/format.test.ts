import { describe, it, expect } from 'vitest'
import {
  formatDebtRange,
  overlapsFloor,
  compareByDebtDesc,
  normalisePhone,
  isValidAuMobile,
  formatPhone,
  describePhone,
  isRecognisedPhone,
  isValidEmail,
  daysBetween,
  formatShortDate,
  formatFullDate,
  formatIsoDate,
  formatAge,
  leadsToCsv,
  partnerForCampaign,
  formatLeadSource,
} from '../format'
import { DEBT_PRESETS, PARTNERS } from '../constants'
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
    metaFormId: null,
    metaAdId: null,
    metaAdgroupId: null,
    metaPageId: null,
    metaCampaignId: null,
    metaCampaignName: null,
    metaAdName: null,
    metaAccountId: null,
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
    ['0298765432', '02 9876 5432'],
    ['0387654321', '03 8765 4321'],
    ['0732109876', '07 3210 9876'],
    ['0891234567', '08 9123 4567'],
    ['+61298765432', '02 9876 5432'],
    ['(02) 9876-5432', '02 9876 5432'],
  ])('formats the landline %s as 0X XXXX XXXX', (input, expected) => {
    expect(formatPhone(input)).toBe(expected)
  })

  it.each([
    ['1300123456', '1300 123 456'],
    ['1800123456', '1800 123 456'],
    ['131234', '13 12 34'],
  ])('formats the service number %s', (input, expected) => {
    expect(formatPhone(input)).toBe(expected)
  })

  it('never groups a number in US style', () => {
    // "(040) 291-5338" is not a number anyone could dial, and MCR's leads are
    // Australian — a US grouping is always wrong here.
    for (const input of ['0402915338', '0298765432', '1300123456', '4155550123']) {
      expect(formatPhone(input)).not.toContain('(')
      expect(formatPhone(input)).not.toContain('-')
    }
  })

  it.each([
    ['412345678', '0412 345 678'], // a form handler coerced the field to a number
    ['4 1234 5678', '0412 345 678'], // ...and someone spaced it out by hand
    ['298765432', '02 9876 5432'], // Sydney landline, same missing zero
    ['387654321', '03 8765 4321'], // Melbourne
    ['732109876', '07 3210 9876'], // Brisbane
    ['891234567', '08 9123 4567'], // Perth
  ])('restores the stripped leading zero on %s', (input, expected) => {
    expect(formatPhone(input)).toBe(expected)
    expect(isRecognisedPhone(input)).toBe(true)
  })

  it('reads a stripped-zero number the same as the number itself', () => {
    // The zero is the only thing that went missing, so the two spellings have
    // to land on one string — otherwise the same lead reads as two numbers.
    expect(formatPhone('412345678')).toBe(formatPhone('0412345678'))
    expect(formatPhone('298765432')).toBe(formatPhone('0298765432'))
  })

  it.each([
    ['+917018102917', '+91 701 810 2917'], // India
    ['+77780001985', '+7 778 000 1985'], // Kazakhstan, on Russia's +7
    ['+6421555017', '+64 215 550 17'], // New Zealand — threes, not NZ's own convention
    ['+447700900412', '+44 770 090 0412'], // United Kingdom
    ['+12025550143', '+1 202 555 0143'], // United States
    ['+971501234567', '+971 501 234 567'], // UAE, a three-digit code
    ['+91 70181 02917', '+91 701 810 2917'], // already spaced, regrouped
  ])('formats the international number %s', (input, expected) => {
    expect(formatPhone(input)).toBe(expected)
  })

  it('never moves a digit, only inserts spaces', () => {
    // The one thing a phone formatter must not do. A mistyped grouping reads
    // as a different number and gets dialled as one — worse than no grouping.
    for (const input of ['+917018102917', '+77780001985', '+999123456789', '+35312345678']) {
      expect(formatPhone(input).replace(/ /g, '')).toBe(input.replace(/ /g, ''))
    }
  })

  it('groups an unknown country code whole rather than splitting it wrong', () => {
    // +999 is unassigned. Nothing in the number says where the code ends, so
    // nothing here claims to know: the digits are grouped in threes and no
    // country code is marked off.
    expect(formatPhone('+999123456789')).toBe('+999 123 456 789')
  })

  it('leaves the Australian shapes exactly as they were', () => {
    // +61 is folded to a leading 0 by normalisePhone, so the international
    // case must never see an Australian number.
    expect(formatPhone('+61402915338')).toBe('0402 915 338')
    expect(formatPhone('+61298765432')).toBe('02 9876 5432')
  })

  it('returns input with no digits in it untouched', () => {
    // Nothing to group, so nothing is done to it.
    expect(formatPhone('switchboard')).toBe('switchboard')
    expect(formatPhone('')).toBe('')
    expect(formatPhone('n/a')).toBe('n/a')
  })

  it('returns digits mixed with anything else untouched', () => {
    // Grouping by digit count would have to either drop the rest or space it
    // at random. Both misrepresent what was typed, so neither is done.
    expect(formatPhone('0412-abc-999')).toBe('0412-abc-999')
    expect(formatPhone('0402 915 338 (mob)')).toBe('0402 915 338 (mob)')
  })

  // ---- best-effort fallback ------------------------------------------------

  it.each([
    ['945359847', '9453 598 47'], // 9  -> XXXX XXX XX
    ['1234567890', '1234 567 890'], // 10 -> XXXX XXX XXX
    ['86856416735', '8685 641 673 5'], // 11 -> remainder after one more space
    ['868564167351', '8685 641 673 51'], // 12 -> ditto, two digits left over
  ])('groups the unrecognised %s as %s', (input, expected) => {
    expect(formatPhone(input)).toBe(expected)
  })

  it('leaves the stripped-zero landlines to their own case, not the fallback', () => {
    // A nine-digit number opening on 2, 3, 7 or 8 is a landline that lost its
    // leading 0, and that case runs first — so "745359847" is the Brisbane
    // number 07 4535 9847, not the fallback's "7453 598 47". Only nine-digit
    // numbers opening on something else (0, 1, 5, 6, 9) reach the fallback.
    expect(formatPhone('745359847')).toBe('07 4535 9847')
    expect(isRecognisedPhone('745359847')).toBe(true)
    expect(formatPhone('945359847')).toBe('9453 598 47')
    expect(isRecognisedPhone('945359847')).toBe(false)
  })

  it.each([
    ['12345678', '123 456 78'], // 8, threes from the left
    ['1234567', '123 4567'], // 7 — the last group runs on rather than strand a digit
    ['12345', '123 45'], // 5
    ['1', '1'], // one digit, nothing to group
  ])('groups the short %s as %s', (input, expected) => {
    expect(formatPhone(input)).toBe(expected)
  })

  it.each([
    '945359847',
    '1234567890',
    '86856416735',
    '868564167351',
    '12345678901234567890',
    '12345678',
    '987654321',
    '512345678',
    '4155550123',
  ])('preserves %s digit for digit', (input) => {
    // The one invariant the fallback cannot break. Grouping is cosmetic: every
    // digit that went in comes out, in the order it went in, and nothing is
    // added. A dropped or swapped digit is a wrong number that looks right.
    expect(formatPhone(input).replace(/ /g, '')).toBe(input)
  })

  it('preserves the digits of the known shapes too', () => {
    for (const input of ['0402915338', '0298765432', '1800123456', '131234']) {
      expect(formatPhone(input).replace(/ /g, ''), input).toBe(input)
    }
    // The two stripped-zero cases add exactly one 0 at the front and nothing
    // else — the only place in this file where the output gains a digit.
    expect(formatPhone('412345678').replace(/ /g, '')).toBe('0412345678')
    expect(formatPhone('298765432').replace(/ /g, '')).toBe('0298765432')
  })

  it.each([
    // Each of these is a length the fallback also handles, which is the point:
    // "0402915338" groups the same either way, but "0298765432" would come out
    // "0298 765 432" instead of the correct "02 9876 5432" if the fallback got
    // to it first.
    ['0402915338', '0402 915 338'],
    ['0298765432', '02 9876 5432'],
    ['0387654321', '03 8765 4321'],
    ['1800123456', '1800 123 456'],
    ['1300123456', '1300 123 456'],
    ['131234', '13 12 34'],
    ['412345678', '0412 345 678'],
    ['298765432', '02 9876 5432'],
    // ...and the international shapes, which the fallback would otherwise
    // render as an Australian number with a "+" glued to the front.
    ['+917018102917', '+91 701 810 2917'],
    ['+77780001985', '+7 778 000 1985'],
    ['+61402915338', '0402 915 338'],
  ])('keeps %s on its known shape, ahead of the fallback', (input, expected) => {
    expect(formatPhone(input)).toBe(expected)
    expect(isRecognisedPhone(input)).toBe(true)
  })

  it.each([
    '12345678901',
    '987654321',
    '512345678',
    '112345678',
    '12345678',
    '4155550123',
    'switchboard',
  ])('flags %s as unrecognised even though it is grouped', (input) => {
    // Everything with digits is grouped now, so the rendered text no longer
    // says which numbers are real — "8685 641 673 5" scans like a phone number.
    // `recognised` is the only thing that still distinguishes them, and the
    // table dims on it.
    expect(isRecognisedPhone(input)).toBe(false)
  })

  it('keeps describePhone and formatPhone in step', () => {
    for (const input of ['0402915338', '412345678', '987654321', '+77780001985']) {
      expect(formatPhone(input), input).toBe(describePhone(input).text)
    }
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

// ============================================================
// Source and partner
// ============================================================

describe('partnerForCampaign', () => {
  it('finds the marker wherever it sits in the name', () => {
    // The point of a pattern: the quarter and the month move, the marker does
    // not, and none of these should need a new PARTNERS entry.
    expect(partnerForCampaign('EPICDM Q4 Prospecting')).toBe('EPIC DM')
    expect(partnerForCampaign('MCR26 EPICDM Apr24')).toBe('EPIC DM')
    expect(partnerForCampaign('MCR26-EPICDM-Q4')).toBe('EPIC DM')
  })

  it('ignores case', () => {
    expect(partnerForCampaign('mcr26 epicdm q4')).toBe('EPIC DM')
  })

  it('only matches C-COLD-MCR at the start, as the pattern is anchored', () => {
    expect(partnerForCampaign('C-COLD-MCR Q4')).toBe('TBC')
    expect(partnerForCampaign('C-COLD-MCR-Apr24')).toBe('TBC')
    expect(partnerForCampaign('Retargeting C-COLD-MCR Q4')).toBeNull()
  })

  it('returns null for an in-house campaign, an absent one, and an empty one', () => {
    // All three render as plain "Facebook" — none of them may claim a partner.
    expect(partnerForCampaign('MCR26 | SBR | Prospecting')).toBeNull()
    expect(partnerForCampaign(null)).toBeNull()
    expect(partnerForCampaign('')).toBeNull()
  })

  it('does NOT match a marker glued to an underscore', () => {
    // `\b` sits between a word character and a non-word one, and `_` counts as
    // a word character — so an underscore-separated name misses. Meta names
    // frequently use underscores (this Page's own form is
    // MCR26_MAIN_LeadForm_SBR-Verifed), so if the real campaigns are named that
    // way the patterns in PARTNERS need widening to treat `_` as a separator.
    // Pinned deliberately: this is the behaviour of the configured patterns,
    // and it should fail loudly here if someone changes them.
    expect(partnerForCampaign('MCR26_EPICDM_Q4')).toBeNull()
    expect(partnerForCampaign('C-COLD-MCR_Q4_Apr24')).toBeNull()
  })

  it('keeps every pattern free of the g flag', () => {
    // A /g regex carries lastIndex between .test() calls, so it would match
    // every other lead and nobody would work out why.
    for (const partner of PARTNERS) {
      expect(partner.pattern.global).toBe(false)
    }
  })
})

describe('formatLeadSource', () => {
  it('reads "Facebook · EPIC DM" when the partner is known', () => {
    const lead = makeLead({ source: 'facebook', metaCampaignName: 'MCR26 EPICDM Q4' })
    expect(formatLeadSource(lead)).toBe('Facebook · EPIC DM')
  })

  it('falls back to plain "Facebook" when the campaign is unknown or absent', () => {
    expect(formatLeadSource(makeLead({ metaCampaignName: null }))).toBe('Facebook')
    expect(formatLeadSource(makeLead({ metaCampaignName: 'MCR26 | SBR | House' }))).toBe(
      'Facebook',
    )
  })

  it('abbreviates the source but never the partner', () => {
    // The partner is the part being scanned for; the source is the part the
    // reader already knows from the column it is in.
    const lead = makeLead({ metaCampaignName: 'EPICDM Q4' })
    expect(formatLeadSource(lead, 'short')).toBe('FB · EPIC DM')
    expect(formatLeadSource(makeLead({ metaCampaignName: null }), 'short')).toBe('FB')
  })

  it('never claims a partner for a lead that did not come from an ad', () => {
    // A manual or website lead has no campaign name at all, so there is nothing
    // to match and nothing to show.
    expect(formatLeadSource(makeLead({ source: 'manual' }))).toBe('Added manually')
    expect(formatLeadSource(makeLead({ source: 'website' }))).toBe('Website')
  })

  it('shows TBC rather than hiding an unconfirmed partner', () => {
    // An unattributed campaign must not read like an in-house one — that is the
    // whole reason the placeholder exists.
    expect(formatLeadSource(makeLead({ metaCampaignName: 'C-COLD-MCR Q4' }))).toBe(
      'Facebook · TBC',
    )
  })
})
