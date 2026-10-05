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
    sourceLabel: null,
    company: null,
    nextStep: null,
    stageSince: '2026-08-20T00:00:00.000Z',
    lastActionAt: '2026-08-30T00:00:00.000Z',
    lastEnquiryAt: '2026-08-01T00:00:00.000Z',
    enquiryCount: 1,
    latestEnquirySource: null,
    reenquiredAfterCloseAt: null,
    reenquiryDismissedAt: null,
    reenquiryDismissedBy: null,
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

// Synthetic numbers that pass their check digits. ACN 123 456 780; the
// company's own ABN is 11 + that ACN; 51 824 753 556 (the ATO's published
// example) stands in for a trust's ABN.
const ACN = '123 456 780'
const COMPANY_ABN = '11 123 456 780'
const TRUST_ABN = '51 824 753 556'

function company(overrides: Partial<ConversionForm> = {}): ConversionForm {
  return {
    ...emptyConversionForm(lead()),
    companyName: 'Whitlock Civil Pty Ltd',
    acnNumber: ACN,
    abnNumber: COMPANY_ABN,
    ...overrides,
  }
}

/** A company acting as trustee, with no ABN of its own. */
function trustee(overrides: Partial<ConversionForm> = {}): ConversionForm {
  return {
    ...emptyConversionForm(lead({ entityType: 'trust' })),
    companyName: 'Whitlock Holdings Pty Ltd',
    acnNumber: ACN,
    trustName: 'Whitlock Family Trust',
    trustAbnNumber: TRUST_ABN,
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

  it("pre-fills the company phone and email from the lead's own", () => {
    // The person who enquired is the company's contact; both stay editable.
    const form = emptyConversionForm(lead())
    expect(form.phoneNumber).toBe('0407 552 118')
    expect(form.emailAddress).toBe('dean@whitlockcivil.com.au')
  })

  it('leaves the company phone and email blank when there is no lead', () => {
    const form = emptyConversionForm(null)
    expect(form.phoneNumber).toBe('')
    expect(form.emailAddress).toBe('')
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

  it('requires the name, email, company name and ACN', () => {
    const errors = validateConversion(
      company({ name: '', email: '', companyName: '', acnNumber: '', abnNumber: '' }),
    )
    expect(errors.name).toBeTruthy()
    expect(errors.email).toBeTruthy()
    expect(errors.companyName).toBeTruthy()
    expect(errors.acnNumber).toBeTruthy()
  })

  it('does not require the company ABN — a company can have only an ACN', () => {
    expect(hasErrors(validateConversion(company({ abnNumber: '' })))).toBe(false)
  })

  it('does not require the trust fields, but checks a trust ABN that is typed', () => {
    expect(hasErrors(validateConversion(company({ trustName: '', trustAbnNumber: '' })))).toBe(false)
    const errors = validateConversion(company({ trustName: '', trustAbnNumber: 'junk' }))
    expect(errors.trustName).toBeUndefined()
    expect(errors.trustAbnNumber).toBeTruthy()
  })

  it('checks length and checksum, spacing aside', () => {
    expect(validateConversion(company({ acnNumber: '12345' })).acnNumber).toBeTruthy()
    expect(validateConversion(company({ acnNumber: '123 456 789' })).acnNumber).toMatch(/check digit/)
    expect(validateConversion(company({ abnNumber: '123456789' })).abnNumber).toBeTruthy()
    expect(validateConversion(company({ abnNumber: '12 345 678 901' })).abnNumber).toMatch(
      /check digits/,
    )
  })

  it("rejects a company ABN that doesn't end with the ACN", () => {
    expect(validateConversion(company({ abnNumber: TRUST_ABN })).abnNumber).toMatch(
      /move it to the trust ABN/,
    )
  })
})

describe('validateConversion — a company acting as trustee', () => {
  it('accepts one whose company has no ABN of its own', () => {
    expect(hasErrors(validateConversion(trustee()))).toBe(false)
  })

  it('accepts one whose company has its own ABN as well', () => {
    expect(hasErrors(validateConversion(trustee({ abnNumber: COMPANY_ABN })))).toBe(false)
  })

  it('still requires the company name and ACN', () => {
    const errors = validateConversion(trustee({ companyName: '', acnNumber: '' }))
    expect(errors.companyName).toBeTruthy()
    expect(errors.acnNumber).toBeTruthy()
  })

  it('requires the trust name and trust ABN', () => {
    const errors = validateConversion(trustee({ trustName: '', trustAbnNumber: '' }))
    expect(errors.trustName).toBeTruthy()
    expect(errors.trustAbnNumber).toBeTruthy()
  })

  it("rejects a trust ABN that is the company's own", () => {
    expect(validateConversion(trustee({ trustAbnNumber: COMPANY_ABN })).trustAbnNumber).toMatch(
      /company's own ABN/,
    )
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
    expect(toCompanyDetails(company()).acnNumber).toBe(ACN)
  })

  it('saves the entity type and both ABNs separately', () => {
    const details = toCompanyDetails(trustee({ abnNumber: COMPANY_ABN }))
    expect(details.entityType).toBe('trust')
    expect(details.abnNumber).toBe(COMPANY_ABN)
    expect(details.trustAbnNumber).toBe(TRUST_ABN)
  })

  it('saves a trust typed for a Company', () => {
    const details = toCompanyDetails(
      company({ trustName: 'Whitlock Family Trust', trustAbnNumber: TRUST_ABN }),
    )
    expect(details.entityType).toBe('company')
    expect(details.trustName).toBe('Whitlock Family Trust')
    expect(details.trustAbnNumber).toBe(TRUST_ABN)
  })

  it('never saves the manual-mode checkboxes', () => {
    const details = toCompanyDetails(company({ companyManual: true, trustManual: true }))
    expect(details).not.toHaveProperty('companyManual')
    expect(details).not.toHaveProperty('trustManual')
  })
})
