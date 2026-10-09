import { describe, it, expect } from 'vitest'
import {
  emptyConversionForm,
  toCompanyDetails,
  type ConversionForm,
} from '../conversionForm'
import type { Lead } from '@/types/leads'

/**
 * The conversion form: what it starts from and what it sends. Nothing on it is
 * required, so there is no validation to pin here.
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

  it('falls back to company when the lead never said', () => {
    expect(emptyConversionForm(lead({ entityType: null })).entityType).toBe('company')
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

  it('drops a director row with no name, which the API would refuse', () => {
    const details = toCompanyDetails(
      company({
        directors: [
          { name: '', dateOfBirth: '1970' },
          { name: 'Dean Whitlock', dateOfBirth: 'not a date' },
        ],
      }),
    )
    expect(details.directors).toEqual([{ name: 'Dean Whitlock', dateOfBirth: null }])
  })

  it('sends whatever was typed, unchecked — nothing at conversion is validated', () => {
    const details = toCompanyDetails(company({ acnNumber: '12345', abnNumber: 'junk' }))
    expect(details.acnNumber).toBe('12345')
    expect(details.abnNumber).toBe('junk')
  })

  it('never saves the manual-mode checkboxes', () => {
    const details = toCompanyDetails(company({ companyManual: true, trustManual: true }))
    expect(details).not.toHaveProperty('companyManual')
    expect(details).not.toHaveProperty('trustManual')
  })
})
