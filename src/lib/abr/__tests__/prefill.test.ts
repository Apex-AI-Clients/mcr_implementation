import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { parseAbnDetails } from '../parse'
import { prefillFromAbr, resolveEntityType } from '../prefill'
import { emptyConversionForm, identityOf } from '@/lib/leads/conversionForm'
import { identityPatchForPick, validateIdentity } from '@/lib/clients/identity'
import type { AbrEntityDetails, AbrPrefill } from '../types'
import type { ConversionForm } from '@/lib/leads/conversionForm'

/** The shared company/trust rules intake applies (the conversion form checks nothing). */
function checkIdentity(form: ConversionForm) {
  return validateIdentity(identityOf(form), { companyAbnRequired: false })
}

/**
 * A picked register entity -> what the register says about it.
 *
 * Two things are load-bearing and both are asserted below: what it fills has to
 * pass validation unchanged once routed to the right section
 * (identityPatchForPick), and what it does not know it must leave alone rather
 * than blank out.
 */

function details(name: string): AbrEntityDetails {
  const parsed = parseAbnDetails(readFileSync(join(__dirname, 'fixtures', `${name}.txt`), 'utf8'))
  if (!parsed) throw new Error(`fixture ${name} has no entity`)
  return parsed
}

function form(overrides: Partial<ConversionForm> = {}): ConversionForm {
  return {
    ...emptyConversionForm(null),
    name: 'Dean Whitlock',
    email: 'dean@whitlockcivil.com.au',
    ...overrides,
  }
}

/** A pick made in the company box, applied to a form. */
function picked(prefill: AbrPrefill, overrides: Partial<ConversionForm> = {}): ConversionForm {
  const base = form(overrides)
  return { ...base, ...identityPatchForPick('company', prefill, base).patch }
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

  it('produces values validation accepts unchanged — the ABN ends with the ACN', () => {
    expect(checkIdentity(picked(patch))).toEqual({})
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
    const existing = picked(patch, { entityType: 'trust', acnNumber: '123456780' })
    expect(existing.acnNumber).toBe('123456780')
  })

  it('lands in the trust fields, and validates once the trustee company is typed', () => {
    const filledIn = picked(patch, {
      entityType: 'trust',
      companyName: 'Smith Holdings Pty Ltd',
      acnNumber: '123456780',
    })
    // The pick cleared the searched company box; put the trustee back.
    expect(filledIn.companyName).toBe('')
    expect(filledIn.trustAbnNumber).toBe('82653091178')
    expect(filledIn.abnNumber).toBe('')
    expect(
      checkIdentity({ ...filledIn, companyName: 'Smith Holdings Pty Ltd' }),
    ).toEqual({})
  })
})

describe('prefillFromAbr — cancelled ABN', () => {
  it('still fills the details; the status is the UI’s job to shout about', () => {
    const source = details('abn_details_cancelled')
    const patch = prefillFromAbr(source)
    expect(source.abnStatus).toBe('Cancelled')
    expect(patch.companyName).toBe('Whitlock Civil Contracting Pty Ltd')
    expect(patch.abnNumber).toBe('30604882439')
    expect(checkIdentity(picked(patch))).toEqual({})
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
