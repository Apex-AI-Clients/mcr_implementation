import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { parseAbnDetails } from '../parse'
import { prefillFor, prefillFromAbr, resolveEntityType } from '../prefill'
import { validateConversion } from '@/lib/leads/conversionForm'
import type { AbrEntityDetails } from '../types'
import type { ConversionForm } from '@/lib/leads/conversionForm'

/**
 * A picked register entity -> the conversion fields it fills.
 *
 * Two things are load-bearing and both are asserted below: what it fills has to
 * pass the existing validation unchanged, and what it does not know it must
 * leave alone rather than blank out.
 */

function details(name: string): AbrEntityDetails {
  const parsed = parseAbnDetails(readFileSync(join(__dirname, 'fixtures', `${name}.txt`), 'utf8'))
  if (!parsed) throw new Error(`fixture ${name} has no entity`)
  return parsed
}

function form(overrides: Partial<ConversionForm> = {}): ConversionForm {
  return {
    name: 'Dean Whitlock',
    email: 'dean@whitlockcivil.com.au',
    entityType: 'company',
    companyName: '',
    acnNumber: '',
    abnNumber: '',
    trustName: '',
    phoneNumber: '',
    emailAddress: '',
    ...overrides,
  }
}

describe('prefillFromAbr — company', () => {
  const patch = prefillFromAbr(details('abn_details_company'))

  it('fills the company name, tidied out of ALL CAPS', () => {
    expect(patch.companyName).toBe('Whitlock Civil Pty Ltd')
  })

  it('fills the ABN and ACN as the register gives them — unspaced digits', () => {
    // No screen in this app formats either number; they are rendered exactly as
    // stored. Filling them in the register's own shape keeps lookup-filled
    // records identical to hand-typed ones.
    expect(patch.abnNumber).toBe('53004085616')
    expect(patch.acnNumber).toBe('004085616')
  })

  it('sets the entity type from the code', () => {
    expect(patch.entityType).toBe('company')
  })

  it('never touches the trust name', () => {
    expect(patch).not.toHaveProperty('trustName')
  })

  it('never touches phone or email — neither is on the public register', () => {
    expect(patch).not.toHaveProperty('phoneNumber')
    expect(patch).not.toHaveProperty('emailAddress')
  })

  it('produces values the existing validation accepts unchanged', () => {
    expect(validateConversion(form(patch))).toEqual({})
  })

  it('passes the 9-digit ACN and 11-digit ABN checks', () => {
    const errors = validateConversion(form({ ...patch, acnNumber: patch.acnNumber }))
    expect(errors.acnNumber).toBeUndefined()
    expect(errors.abnNumber).toBeUndefined()
  })
})

describe('prefillFromAbr — trust', () => {
  const patch = prefillFromAbr(details('abn_details_trust'))

  it('fills the trust name with the trustee prefix stripped', () => {
    expect(patch.trustName).toBe('Smith Family Trust')
  })

  it('sets the entity type to trust', () => {
    expect(patch.entityType).toBe('trust')
  })

  it('leaves the company name for a person — ABR does not name the trustee', () => {
    expect(patch).not.toHaveProperty('companyName')
  })

  it('omits the ACN rather than blanking one already typed', () => {
    expect(patch).not.toHaveProperty('acnNumber')
    const existing = form({ entityType: 'trust', acnNumber: '123456789' })
    expect({ ...existing, ...patch }.acnNumber).toBe('123456789')
  })

  it('produces values the existing validation accepts unchanged', () => {
    expect(validateConversion(form({ entityType: 'trust', ...patch }))).toEqual({})
  })
})

describe('prefillFromAbr — cancelled ABN', () => {
  it('still fills the details; the status is the UI’s job to shout about', () => {
    const source = details('abn_details_cancelled')
    const patch = prefillFromAbr(source)
    expect(source.abnStatus).toBe('Cancelled')
    expect(patch.companyName).toBe('Whitlock Civil Contracting Pty Ltd')
    expect(patch.abnNumber).toBe('61604882436')
    expect(validateConversion(form(patch))).toEqual({})
  })
})

describe('resolveEntityType', () => {
  function entity(overrides: Partial<AbrEntityDetails>): AbrEntityDetails {
    return {
      abn: '53004085616',
      abnStatus: 'Active',
      status: 'active',
      abnStatusEffectiveFrom: '',
      acn: '',
      entityName: '',
      entityTypeCode: '',
      entityTypeName: '',
      state: '',
      postcode: '',
      ...overrides,
    }
  }

  it('reads the trustee prefix when the code says nothing', () => {
    expect(
      resolveEntityType(
        entity({ entityTypeCode: 'ZZZ', entityName: 'THE TRUSTEE FOR SMITH FAMILY TRUST' }),
      ),
    ).toBe('trust')
  })

  it('lets an explicit code win over the name', () => {
    expect(
      resolveEntityType(entity({ entityTypeCode: 'PRV', entityName: 'TRUSTEE SERVICES PTY LTD' })),
    ).toBe('company')
  })

  it('returns null for an entity the register does not classify either way', () => {
    expect(
      resolveEntityType(
        entity({ entityTypeCode: 'IND', entityTypeName: 'Individual/Sole Trader' }),
      ),
    ).toBeNull()
  })

  it('leaves the form’s own entity type standing when unresolved', () => {
    const patch = prefillFromAbr(
      entity({ entityTypeCode: 'IND', entityTypeName: 'Individual/Sole Trader' }),
    )
    expect(patch).not.toHaveProperty('entityType')
    expect({ ...form({ entityType: 'trust' }), ...patch }.entityType).toBe('trust')
  })
})

describe('prefillFor', () => {
  const company = prefillFromAbr(details('abn_details_company'))
  const trust = prefillFromAbr(details('abn_details_trust'))

  it('leaves the searched box alone when the register filled it', () => {
    expect(prefillFor('companyName', company).companyName).toBe('Whitlock Civil Pty Ltd')
  })

  it('clears the company box when the search landed on a trust', () => {
    // What is left in it is a search term, not a trustee company.
    expect(prefillFor('companyName', trust).companyName).toBe('')
    expect(prefillFor('companyName', trust).trustName).toBe('Smith Family Trust')
  })

  it('clears the trust box when the search landed on a company', () => {
    expect(prefillFor('trustName', company).trustName).toBe('')
    expect(prefillFor('trustName', company).companyName).toBe('Whitlock Civil Pty Ltd')
  })

  it('touches nothing else — a trustee company survives a pick in the trust box', () => {
    const patch = prefillFor('trustName', trust)
    expect(patch).not.toHaveProperty('companyName')
    expect({ companyName: 'Smith Holdings Pty Ltd', ...patch }.companyName).toBe(
      'Smith Holdings Pty Ltd',
    )
  })

  it('never invents a phone or email, whichever box was searched', () => {
    for (const box of ['companyName', 'trustName'] as const) {
      const patch = prefillFor(box, company)
      expect(patch).not.toHaveProperty('phoneNumber')
      expect(patch).not.toHaveProperty('emailAddress')
    }
  })

  it('does not mutate what it was given', () => {
    const before = { ...trust }
    prefillFor('companyName', trust)
    expect(trust).toEqual(before)
  })
})
