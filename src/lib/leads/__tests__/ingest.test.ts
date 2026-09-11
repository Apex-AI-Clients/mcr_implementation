import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  mapLead,
  flattenFacebookFields,
  isHoneypotTripped,
  parseLooseDebt,
  mapDebtLabel,
  RAW_DEBT_NOTE_PREFIX,
} from '../ingest'
import { formatDebtRange } from '../format'
import {
  WEBSITE_DEBT_CODES,
  DEBT_FIELD_FORMAT,
  DEBT_LABELS,
  FIELD_MAPS,
  MIN_PLAUSIBLE_DEBT,
  normaliseDebtLabel,
} from '../ingestConfig'

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
    expect(fields.debt_range).toBe('$100,000 - $124,999')
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
    // Meta returns the option's label text, which the 'label' format resolves.
    expect(result.lead.debtMin).toBe(100_000)
    expect(result.lead.debtMax).toBe(124_999)
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

// ============================================================
// facebook — the option's label text, not a positional code
// ============================================================

describe('normaliseDebtLabel', () => {
  it('folds every separator Meta might emit to one form', () => {
    const canonical = normaliseDebtLabel('$100,000 - $124,999')
    for (const variant of [
      '$100,000 ' + '\u2013' + ' $124,999', // en dash — what Meta's editor produces
      '$100,000 ' + '\u2014' + ' $124,999', // em dash
      '$100,000 ' + '\u2011' + ' $124,999', // non-breaking hyphen
      '$100,000 to $124,999',
      '$100,000-$124,999',
      '  $100,000   -   $124,999  ',
      '$100,000 - $124,999'.toUpperCase(),
    ]) {
      expect(normaliseDebtLabel(variant), variant).toBe(canonical)
    }
  })

  it('drops currency symbols and thousands separators', () => {
    expect(normaliseDebtLabel('$150,000+')).toBe('150000+')
  })
})

describe('DEBT_LABELS', () => {
  it('is the format configured for facebook', () => {
    expect(DEBT_FIELD_FORMAT.facebook).toBe('label')
  })

  it('keeps open-ended labels open-ended', () => {
    for (const label of ['$150,000 or +', '$150k+', 'over $150,000', '$500k+', 'over $500,000']) {
      expect(mapDebtLabel(label)?.max, label).toBeNull()
    }
  })

  it('covers both bracket sets', () => {
    // The website's consumer brackets...
    expect(mapDebtLabel('$30,000 - $49,999')).toEqual({ min: 30_000, max: 49_999 })
    expect(mapDebtLabel('$75,000 - $99,999')).toEqual({ min: 75_000, max: 99_999 })
    // ...and the larger business ones.
    expect(mapDebtLabel('$250,000 - $500,000')).toEqual({ min: 250_000, max: 500_000 })
    expect(mapDebtLabel('$500,000 or +')).toEqual({ min: 500_000, max: null })
  })

  it('never holds an inverted range', () => {
    for (const [key, range] of Object.entries(DEBT_LABELS)) {
      if (range.min !== null && range.max !== null) {
        expect(range.max, key).toBeGreaterThanOrEqual(range.min)
      }
    }
  })

  it('returns null for a label it does not know, rather than a guess', () => {
    expect(mapDebtLabel('roughly a hundred grand')).toBeNull()
    expect(mapDebtLabel('')).toBeNull()
    expect(mapDebtLabel(null)).toBeNull()
  })

  it('does not fall back to the positional code table', () => {
    // "3" is a code, not a label. Reading it here would silently produce
    // $100k-$125k — the bug this format exists to avoid.
    expect(mapDebtLabel('3')).toBeNull()
  })
})

describe('mapLead — facebook label debt', () => {
  function fbLead(fixtureName: string) {
    const fields = flattenFacebookFields(fixture(fixtureName).field_data)
    return mapLead(fields, 'facebook', 'fb-1')
  }

  it('resolves an exact label', () => {
    const result = fbLead('facebook_lead_fields')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.lead.debtMin).toBe(100_000)
    expect(result.lead.debtMax).toBe(124_999)
    // Matched, so the message is left exactly as written.
    expect(result.lead.message).toBe('Mostly plant finance rather than tax.')
  })

  it('resolves the en dash variant Meta actually sends', () => {
    const result = fbLead('facebook_debt_endash')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.lead.debtMin).toBe(100_000)
    expect(result.lead.debtMax).toBe(124_999)
  })

  it('resolves an uppercased label', () => {
    const result = fbLead('facebook_debt_uppercase')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.lead.debtMin).toBe(100_000)
    expect(result.lead.debtMax).toBe(124_999)
  })

  it('keeps "$150,000 or +" open-ended', () => {
    const result = fbLead('facebook_debt_openended')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.lead.debtMin).toBe(150_000)
    expect(result.lead.debtMax).toBeNull()
    expect(formatDebtRange(result.lead.debtMin, result.lead.debtMax)).toBe('$150k+')
  })

  it('preserves an unmatched label in the message instead of guessing', () => {
    const result = fbLead('facebook_debt_unmatched')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.lead.debtMin).toBeNull()
    expect(result.lead.debtMax).toBeNull()
    expect(result.lead.message).toBe(
      'Mostly plant finance rather than tax.\n\n' +
        RAW_DEBT_NOTE_PREFIX +
        ' Somewhere between a lot and heaps',
    )
  })

  it('leaves the message untouched when the debt field is empty', () => {
    const result = fbLead('facebook_debt_empty')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.lead.debtMin).toBeNull()
    expect(result.lead.debtMax).toBeNull()
    // Nothing was answered, so there is nothing to preserve.
    expect(result.lead.message).toBe('Mostly plant finance rather than tax.')
    expect(result.lead.message).not.toContain(RAW_DEBT_NOTE_PREFIX)
  })

  it('does not read a label through the free-text parser', () => {
    // A two-number label is "ambiguous" to parseLooseDebt; the label format
    // must resolve it rather than discard it.
    expect(parseLooseDebt('$100,000 - $124,999').kind).toBe('unparseable')
    const result = fbLead('facebook_lead_fields')
    expect(result.ok && result.lead.debtMin).toBe(100_000)
  })
})


// ============================================================
// facebook — MCR26_MAIN_LeadForm_SBR-Verifed, form 1681820256160730
// ============================================================

describe('mapLead — the live MCR26_MAIN Facebook form', () => {
  function mcr26(fixtureName: string, externalId: string) {
    const fields = flattenFacebookFields(fixture(fixtureName).field_data)
    return mapLead(fields, 'facebook', externalId)
  }

  it('maps a complete submission from the real form', () => {
    const result = mcr26('facebook_mcr26_main', 'fb-1120394857601928')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.lead).toEqual({
      name: 'Marissa Thorne',
      email: 'marissa@thornefitout.com.au',
      phone: '0412887340',
      debtMin: 100_000,
      debtMax: 250_000,
      state: 'NSW',
      entityType: 'company',
      message: 'Two BAS quarters behind, director penalty letter arrived Monday.',
      // This form has no call-time question, so the column stays empty rather
      // than being filled from something that was never an answer to it.
      preferredCallTime: null,
      source: 'facebook',
      externalId: 'fb-1120394857601928',
    })
  })

  it('keeps the trailing "?" and the parentheses, which are part of the key', () => {
    // Meta derives a custom question's key from the question text. Normalising
    // the punctuation out of these would match nothing at all.
    expect(FIELD_MAPS.facebook.debt).toContain(
      'what_is_the_amount_of_ato_debt_you_are_dealing_with?',
    )
    expect(FIELD_MAPS.facebook.state).toContain('which_state_are_you_from?')
    expect(FIELD_MAPS.facebook.entityType).toContain('do_you_run_a_company_(pty_ltd)_or_trust?')
    expect(FIELD_MAPS.facebook.message).toContain(
      'anything_else_you_want_us_to_know_before_we_call_you?',
    )
  })

  it('reads "$250-$500k" — the missing "k" is on the live form, not a typo here', () => {
    const result = mcr26('facebook_mcr26_250_500', 'fb-1120394857602044')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.lead.debtMin).toBe(250_000)
    expect(result.lead.debtMax).toBe(500_000)
    // Matched, so nothing is appended to what the lead wrote.
    expect(result.lead.message).toBe('Payment plan defaulted in July.')
    expect(result.lead.message).not.toContain(RAW_DEBT_NOTE_PREFIX)
  })

  it('reads "$500k +" with the space, and keeps it open-ended', () => {
    const result = mcr26('facebook_mcr26_500_plus', 'fb-1120394857602171')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.lead.debtMin).toBe(500_000)
    // Half a million "or more" must never be shown as a bracket that closes.
    expect(result.lead.debtMax).toBeNull()
    expect(formatDebtRange(result.lead.debtMin, result.lead.debtMax)).toBe('$500k+')
    expect(result.lead.message).toBeNull()
  })

  it('folds "$500k +" and "$500k+" to one key', () => {
    expect(normaliseDebtLabel('$500k +')).toBe(normaliseDebtLabel('$500k+'))
    expect(mapDebtLabel('$500k +')).toEqual({ min: 500_000, max: null })
    expect(mapDebtLabel('$500k+')).toEqual({ min: 500_000, max: null })
  })

  it('maps Meta\'s "Pty Ltd" option value, not just the word "Company"', () => {
    expect(mcr26('facebook_mcr26_main', 'e1')).toMatchObject({
      lead: { entityType: 'company' },
    })
    expect(mcr26('facebook_mcr26_500_plus', 'e2')).toMatchObject({
      lead: { entityType: 'trust' },
    })
  })

  it('reads NT, which this form offers and the website form does not', () => {
    const result = mcr26('facebook_mcr26_500_plus', 'fb-nt')
    expect(result.ok && result.lead.state).toBe('NT')
  })

  it('ignores inbox_url, which is Meta internal', () => {
    const fields = flattenFacebookFields(fixture('facebook_mcr26_main').field_data)
    // It is in the payload...
    expect(String(fields.inbox_url)).toContain('business.facebook.com')
    // ...and in no field map, so it reaches no column.
    for (const keys of Object.values(FIELD_MAPS.facebook)) {
      expect(keys).not.toContain('inbox_url')
    }
    // ...and it is not the honeypot, so its presence must not read as spam.
    expect(isHoneypotTripped(fields)).toBe(false)
  })

  it('still reads the wording of the older forms, for the other 18 on the page', () => {
    // MCR26_MAIN is one of 19 active forms and the rest were written with
    // different question text, so the previous keys stay on as fallbacks.
    const fields = flattenFacebookFields(fixture('facebook_lead_fields').field_data)
    const result = mapLead(fields, 'facebook', 'fb-older-form')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.lead.debtMin).toBe(100_000)
    expect(result.lead.state).toBe('WA')
    expect(result.lead.entityType).toBe('company')
    expect(result.lead.message).toBe('Mostly plant finance rather than tax.')
    // An older form that does ask for a call time still fills the column.
    expect(result.lead.preferredCallTime).toBe('Weekday afternoons')
  })

  it('keeps both bracket sets, which overlap at $100k', () => {
    // Facebook's brackets are wider than the website's and both are live, so
    // neither set may displace the other.
    expect(mapDebtLabel('$100k-$250k')).toEqual({ min: 100_000, max: 250_000 })
    expect(mapDebtLabel('$100,000 - $124,999')).toEqual({ min: 100_000, max: 124_999 })
  })
})
