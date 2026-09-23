import { describe, it, expect } from 'vitest'
import {
  emptyConversionForm,
  hasErrors,
  toCompanyDetails,
  validateConversion,
  type ConversionForm,
} from '../conversionForm'
import type { Lead } from '@/types/leads'

/**
 * The gate on conversion.
 *
 * Required-ness follows the entity rather than a flat list, which is the one
 * thing here worth pinning: demanding an ACN from a trust and a trust name
 * from a company would mean somebody typing "N/A" on every conversion, and
 * that junk would then auto-fill the intake form.
 */

function lead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: 'ld_1',
    name: 'Dean Whitlock',
    email: 'dean@whitlockcivil.com.au',
    phone: '0407552118',
    debtMin: 150_000,
    debtMax: null,
    state: 'QLD',
    entityType: 'company',
    message: null,
    preferredCallTime: null,
    stage: 'prospect',
    source: 'website',
    company: null,
    nextStep: null,
    stageSince: '2026-08-20T00:00:00.000Z',
    lastActionAt: '2026-08-30T00:00:00.000Z',
    convertedClientId: null,
    metaFormId: null,
    metaAdId: null,
    metaAdgroupId: null,
    metaPageId: null,
    metaCampaignId: null,
    metaCampaignName: null,
    metaAdName: null,
    metaAccountId: null,
    metaStateRaw: null,
    metaStateOptions: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-30T00:00:00.000Z',
    ...overrides,
  }
}

function company(overrides: Partial<ConversionForm> = {}): ConversionForm {
  return {
    ...emptyConversionForm(lead()),
    companyName: 'Whitlock Civil Pty Ltd',
    acnNumber: '123 456 789',
    abnNumber: '12 345 678 901',
    ...overrides,
  }
}

function trust(overrides: Partial<ConversionForm> = {}): ConversionForm {
  return {
    ...emptyConversionForm(lead({ entityType: 'trust' })),
    trustName: 'Whitlock Family Trust',
    abnNumber: '12345678901',
    ...overrides,
  }
}

describe('emptyConversionForm', () => {
  it('starts from what the lead already told us', () => {
    const form = emptyConversionForm(lead())
    expect(form.name).toBe('Dean Whitlock')
    expect(form.email).toBe('dean@whitlockcivil.com.au')
    expect(form.entityType).toBe('company')
  })

  it("pre-fills the client's own phone from the lead, grouped for reading", () => {
    expect(emptyConversionForm(lead()).phone).toBe('0407 552 118')
  })

  it('leaves the client phone blank when there is no lead', () => {
    expect(emptyConversionForm(null).phone).toBe('')
  })

  it('does not pre-fill the company phone from the lead', () => {
    // That is the director's mobile — it goes in `phone`. A wrong default
    // becomes wrong stored data the moment somebody presses Convert without
    // reading it.
    expect(emptyConversionForm(lead()).phoneNumber).toBe('')
  })

  it('does not require the client phone', () => {
    const errors = validateConversion({ ...emptyConversionForm(lead()), phone: '' })
    expect(errors.phone).toBeUndefined()
  })

  it('falls back to company when the lead never said', () => {
    expect(emptyConversionForm(lead({ entityType: null })).entityType).toBe('company')
  })
})

describe('validateConversion — a company', () => {
  it('accepts a complete one', () => {
    expect(hasErrors(validateConversion(company()))).toBe(false)
  })

  it('requires the name, email, company name, ACN and ABN', () => {
    const errors = validateConversion(
      company({ name: '', email: '', companyName: '', acnNumber: '', abnNumber: '' }),
    )
    expect(errors.name).toBeTruthy()
    expect(errors.email).toBeTruthy()
    expect(errors.companyName).toBeTruthy()
    expect(errors.acnNumber).toBeTruthy()
    expect(errors.abnNumber).toBeTruthy()
  })

  it('does not require a trust name', () => {
    // A Pty Ltd does not have one, and forcing the field would fill it with
    // noise on every conversion.
    expect(validateConversion(company({ trustName: '' })).trustName).toBeUndefined()
  })

  it('checks the ACN and ABN are the right length, spacing aside', () => {
    expect(validateConversion(company({ acnNumber: '123 456 789' })).acnNumber).toBeUndefined()
    expect(validateConversion(company({ acnNumber: '12345' })).acnNumber).toBeTruthy()
    expect(validateConversion(company({ abnNumber: '12 345 678 901' })).abnNumber).toBeUndefined()
    expect(validateConversion(company({ abnNumber: '123456789' })).abnNumber).toBeTruthy()
  })
})

describe('validateConversion — a trust', () => {
  it('accepts one with no ACN and no company', () => {
    // A trust has neither unless there is a corporate trustee.
    expect(hasErrors(validateConversion(trust()))).toBe(false)
  })

  it('requires the trust name', () => {
    expect(validateConversion(trust({ trustName: '' })).trustName).toBeTruthy()
  })

  it('still requires an ABN', () => {
    expect(validateConversion(trust({ abnNumber: '' })).abnNumber).toBeTruthy()
  })

  it('checks a corporate trustee ACN only when one was typed', () => {
    expect(validateConversion(trust({ acnNumber: '' })).acnNumber).toBeUndefined()
    expect(validateConversion(trust({ acnNumber: '999' })).acnNumber).toBeTruthy()
  })
})

describe('validateConversion — the optional pair', () => {
  it('lets the phone and email be blank', () => {
    const errors = validateConversion(company({ phoneNumber: '', emailAddress: '' }))
    expect(errors.phoneNumber).toBeUndefined()
    expect(errors.emailAddress).toBeUndefined()
  })

  it('still checks the entity email when one is given', () => {
    expect(validateConversion(company({ emailAddress: 'nope' })).emailAddress).toBeTruthy()
    expect(
      validateConversion(company({ emailAddress: 'accounts@whitlock.com.au' })).emailAddress,
    ).toBeUndefined()
  })

  it('accepts any phone shape, as the rest of the CRM does', () => {
    // A landline or a switchboard extension is still a real number, and
    // dropping a conversion over a format rule would be absurd.
    expect(validateConversion(company({ phoneNumber: '07 4535 9847' })).phoneNumber).toBeUndefined()
  })
})

describe('toCompanyDetails', () => {
  it('trims everything and lowercases the email', () => {
    const details = toCompanyDetails(
      company({ companyName: '  Whitlock Civil  ', emailAddress: '  Accounts@Whitlock.com.au ' }),
    )
    expect(details.companyName).toBe('Whitlock Civil')
    expect(details.emailAddress).toBe('accounts@whitlock.com.au')
  })

  it('carries the numbers through exactly as typed, spacing included', () => {
    // The intake form shows these back and staff recognise their own
    // formatting; normalising them here would be a silent edit.
    expect(toCompanyDetails(company()).acnNumber).toBe('123 456 789')
  })
})
