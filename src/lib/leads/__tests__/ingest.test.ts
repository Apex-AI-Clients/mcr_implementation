import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  mapLead,
  flattenFacebookFields,
  isHoneypotTripped,
  parseLooseDebt,
  RAW_DEBT_NOTE_PREFIX,
} from '../ingest'
import { formatDebtRange } from '../format'
import { WEBSITE_DEBT_CODES, DEBT_FIELD_FORMAT, MIN_PLAUSIBLE_DEBT } from '../ingestConfig'

/**
 * Ingestion mapping, against committed fixtures of the real payload shapes.
 */

function fixture(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(__dirname, 'fixtures', `${name}.json`), 'utf8'))
}

describe('mapLead — website form', () => {
  it('maps a complete submission', () => {
    const result = mapLead(fixture('website_lead'), 'website', 'ext-1')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.lead).toEqual({
      name: 'Dean Whitlock',
      // Lowercased so the Stage 5 "known email" lookup and the Stage 4 index agree.
      email: 'dean@whitlockcivil.com.au',
      phone: '0407552118',
      debtMin: 100_000,
      debtMax: 124_999,
      state: 'QLD',
      entityType: 'company',
      message: 'ATO have started calling. Three sites running.',
      preferredCallTime: 'After 6pm, on site until then',
      source: 'website',
      externalId: 'ext-1',
    })
  })

  it('treats the unselected state sentinel as null, not as the word "state"', () => {
    const result = mapLead(fixture('website_lead_unselected'), 'website', 'ext-2')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.lead.state).toBeNull()
  })

  it('normalises a +61 phone number', () => {
    const result = mapLead(fixture('website_lead_unselected'), 'website', 'ext-2')
    expect(result.ok && result.lead.phone).toBe('0438671205')
  })

  it('turns a whitespace-only message and empty call time into null', () => {
    const result = mapLead(fixture('website_lead_unselected'), 'website', 'ext-2')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.lead.message).toBeNull()
    expect(result.lead.preferredCallTime).toBeNull()
  })

  it('keeps an open-ended debt code open-ended', () => {
    const result = mapLead(fixture('website_lead_unselected'), 'website', 'ext-2')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // Code 5 is "$150,000 or +" — it must not become a closed bracket.
    expect(result.lead.debtMin).toBe(150_000)
    expect(result.lead.debtMax).toBeNull()
    expect(formatDebtRange(result.lead.debtMin, result.lead.debtMax)).toBe('$150k+')
  })

  it('maps Trust as well as Company', () => {
    const result = mapLead(fixture('website_lead_unselected'), 'website', 'ext-2')
    expect(result.ok && result.lead.entityType).toBe('trust')
  })

  it.each([
    ['-1', 30_000, 49_999],
    ['1', 50_000, 74_999],
    ['2', 75_000, 99_999],
    ['3', 100_000, 124_999],
    ['4', 125_000, 149_999],
    ['5', 150_000, null],
  ])('maps positional debt code %s', (code, min, max) => {
    const result = mapLead(
      { ...fixture('website_lead'), debt_code: code },
      'website',
      'ext-1',
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.lead.debtMin).toBe(min)
    expect(result.lead.debtMax).toBe(max)
  })

  it('stores an unmapped debt code as null rather than guessing', () => {
    const result = mapLead({ ...fixture('website_lead'), debt_code: '99' }, 'website', 'x')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.lead.debtMin).toBeNull()
    expect(result.lead.debtMax).toBeNull()
  })

  it('stores an absent debt code as null', () => {
    const payload = { ...fixture('website_lead') }
    delete payload.debt_code
    const result = mapLead(payload, 'website', 'x')
    expect(result.ok && result.lead.debtMin).toBeNull()
  })

  it('stores an unmapped business type as null', () => {
    const result = mapLead({ ...fixture('website_lead'), biz_type: 'Partnership' }, 'website', 'x')
    expect(result.ok && result.lead.entityType).toBeNull()
  })
})

describe('mapLead — rejections', () => {
  it('rejects a state answered with something unmappable rather than storing junk', () => {
    const result = mapLead({ ...fixture('website_lead'), state: 'Auckland' }, 'website', 'x')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/Unrecognised state/)
  })

  it.each([
    ['name', { name: '' }, /Missing name/],
    ['email', { email: '' }, /Missing email/],
    ['email format', { email: 'not-an-email' }, /Invalid email/],
    ['phone', { phone: '' }, /Missing phone/],
  ])('rejects a missing or invalid %s', (_label, patch, expected) => {
    const result = mapLead({ ...fixture('website_lead'), ...patch }, 'website', 'x')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(expected)
  })

  it('rejects the malformed fixture on the first problem it finds', () => {
    const result = mapLead(fixture('website_lead_malformed'), 'website', 'x')
    expect(result.ok).toBe(false)
  })
})

describe('source is never taken from the body', () => {
  it('uses the caller-supplied source even when the payload claims another', () => {
    const result = mapLead(
      { ...fixture('website_lead'), source: 'facebook' },
      'website',
      'x',
    )
    expect(result.ok && result.lead.source).toBe('website')
  })
})

describe('isHoneypotTripped', () => {
  it('flags a submission with the honeypot filled', () => {
    expect(isHoneypotTripped(fixture('website_lead_spam'))).toBe(true)
  })

  it('passes a genuine submission', () => {
    expect(isHoneypotTripped(fixture('website_lead'))).toBe(false)
  })

  it('ignores an empty or whitespace honeypot', () => {
    expect(isHoneypotTripped({ website_url: '   ' })).toBe(false)
  })
})

describe('flattenFacebookFields', () => {
  it('flattens field_data into a plain payload', () => {
    const fields = flattenFacebookFields(fixture('facebook_lead_fields').field_data)
    expect(fields.full_name).toBe('Oscar Vandeleur')
    expect(fields.phone_number).toBe('+61435872640')
    expect(fields.debt_range).toBe('150k_plus')
  })

  it('survives a missing or non-array field_data', () => {
    expect(flattenFacebookFields(undefined)).toEqual({})
    expect(flattenFacebookFields('nonsense')).toEqual({})
    expect(flattenFacebookFields([null, 42, { values: ['orphan'] }])).toEqual({})
  })

  it('maps a flattened Facebook lead end to end', () => {
    const fields = flattenFacebookFields(fixture('facebook_lead_fields').field_data)
    const result = mapLead(fields, 'facebook', '708090102030405')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.lead.name).toBe('Oscar Vandeleur')
    expect(result.lead.phone).toBe('0435872640')
    // "Western Australia" spelled out, from a custom question.
    expect(result.lead.state).toBe('WA')
    expect(result.lead.entityType).toBe('company')
    expect(result.lead.debtMin).toBe(150_000)
    expect(result.lead.debtMax).toBeNull()
    expect(result.lead.externalId).toBe('708090102030405')
    expect(result.lead.source).toBe('facebook')
  })
})

describe('WEBSITE_DEBT_CODES', () => {
  it('never produces an inverted range', () => {
    for (const [code, range] of Object.entries(WEBSITE_DEBT_CODES)) {
      if (range.min !== null && range.max !== null) {
        expect(range.max, code).toBeGreaterThanOrEqual(range.min)
      }
    }
  })

  it('keeps the numeric codes and their slug equivalents in step', () => {
    // The handler will move from positions to slugs; both must mean the same
    // thing while historical rows still carry the old codes.
    expect(WEBSITE_DEBT_CODES['-1']).toEqual(WEBSITE_DEBT_CODES['30k_50k'])
    expect(WEBSITE_DEBT_CODES['5']).toEqual(WEBSITE_DEBT_CODES['150k_plus'])
  })
})

// ============================================================
// website_results — the debt field is free text, not a select
// ============================================================

describe('parseLooseDebt', () => {
  it.each([
    ['120k', 120_000],
    ['120K', 120_000],
    ['$45,000', 45_000],
    ['45000', 45_000],
    ['45,000.00', 45_000],
    ['approx 120k', 120_000],
    ['$1.2m', 1_200_000],
    ['  250000  ', 250_000],
  ])('parses %s as a point figure', (raw, expected) => {
    const result = parseLooseDebt(raw)
    expect(result.kind).toBe('parsed')
    if (result.kind !== 'parsed') return
    // A typed figure is an estimate of an amount, not an open-ended floor.
    expect(result.min).toBe(expected)
    expect(result.max).toBe(expected)
  })

  it.each([null, '', '   '])('treats %s as absent, with nothing to preserve', (raw) => {
    expect(parseLooseDebt(raw).kind).toBe('absent')
  })

  it.each([
    'not sure',
    'a lot',
    'dunno',
    'between 50k and 100k', // two numbers: ambiguous, so not guessed
  ])('treats %s as unparseable rather than guessing', (raw) => {
    const result = parseLooseDebt(raw)
    expect(result.kind).toBe('unparseable')
    if (result.kind !== 'unparseable') return
    expect(result.raw).toBe(raw)
  })

  it('rejects a figure too small to be a debt amount', () => {
    // "3" is a bracket number or a stray keystroke, not three dollars.
    expect(parseLooseDebt('3').kind).toBe('unparseable')
    expect(parseLooseDebt(String(MIN_PLAUSIBLE_DEBT - 1)).kind).toBe('unparseable')
    expect(parseLooseDebt(String(MIN_PLAUSIBLE_DEBT)).kind).toBe('parsed')
  })
})

describe('mapLead — website_results free-text debt', () => {
  const opts = { formKey: 'website_results' }

  it('is configured as a free-text form, unlike the select-based ones', () => {
    expect(DEBT_FIELD_FORMAT.website_results).toBe('free_text')
    for (const key of ['website_home', 'website_inner', 'website_ads']) {
      expect(DEBT_FIELD_FORMAT[key]).toBe('code')
    }
  })

  it('parses "120k"', () => {
    const result = mapLead(fixture('website_results_120k'), 'website', 'r1', opts)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.lead.debtMin).toBe(120_000)
    expect(result.lead.debtMax).toBe(120_000)
    // Parsed cleanly, so the message is left exactly as written.
    expect(result.lead.message).toBe('Freight hire, behind on GST.')
  })

  it('parses "$45,000"', () => {
    const result = mapLead(fixture('website_results_45000'), 'website', 'r2', opts)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.lead.debtMin).toBe(45_000)
    expect(result.lead.debtMax).toBe(45_000)
    expect(result.lead.message).not.toContain(RAW_DEBT_NOTE_PREFIX)
  })

  it('nulls the range for "not sure" and keeps the raw text in the message', () => {
    const result = mapLead(fixture('website_results_notsure'), 'website', 'r3', opts)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.lead.debtMin).toBeNull()
    expect(result.lead.debtMax).toBeNull()
    expect(result.lead.message).toBe(
      'Freight hire, behind on GST.\n\nDebt (as entered): not sure',
    )
  })

  it('leaves the message untouched when the field was left empty', () => {
    const result = mapLead(fixture('website_results_empty'), 'website', 'r4', opts)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.lead.debtMin).toBeNull()
    expect(result.lead.debtMax).toBeNull()
    // Nothing was typed, so there is nothing to preserve.
    expect(result.lead.message).toBe('Freight hire, behind on GST.')
    expect(result.lead.message).not.toContain(RAW_DEBT_NOTE_PREFIX)
  })

  it('does NOT read a typed "3" as the $100k-$125k code', () => {
    const result = mapLead(fixture('website_results_three'), 'website', 'r5', opts)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    // The code table would have made this $100,000-$124,999. It must not.
    expect(result.lead.debtMin).not.toBe(100_000)
    expect(result.lead.debtMax).not.toBe(124_999)
    expect(result.lead.debtMin).toBeNull()
    expect(result.lead.debtMax).toBeNull()
    expect(result.lead.message).toContain('Debt (as entered): 3')
  })

  it('reads the same "3" through the code table on a select-based form', () => {
    // Same payload, different form: this is the distinction the config draws.
    const result = mapLead(fixture('website_results_three'), 'website', 'r5', {
      formKey: 'website_home',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.lead.debtMin).toBe(100_000)
    expect(result.lead.debtMax).toBe(124_999)
    expect(result.lead.message).toBe('Freight hire, behind on GST.')
  })

  it('preserves the raw value even when there was no message at all', () => {
    const payload = { ...fixture('website_results_notsure'), message: '' }
    const result = mapLead(payload, 'website', 'r6', opts)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.lead.message).toBe('Debt (as entered): not sure')
  })

  it('ignores debt_label, which this form always posts empty', () => {
    const payload = { ...fixture('website_results_120k'), debt_label: '' }
    const result = mapLead(payload, 'website', 'r7', opts)
    expect(result.ok && result.lead.debtMin).toBe(120_000)
  })

  it('defaults to the code table for an unconfigured form key', () => {
    // Safer default: an unknown form cannot accidentally get free-text
    // treatment and start storing typed figures as exact amounts.
    const result = mapLead(fixture('website_results_three'), 'website', 'r8', {
      formKey: 'website_something_new',
    })
    expect(result.ok && result.lead.debtMin).toBe(100_000)
  })
})
