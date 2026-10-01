import { describe, it, expect } from 'vitest'
import {
  atoAbnFor,
  canMoveAbnToTrust,
  identityForSave,
  identityPatchForPick,
  moveAbnToTrust,
  validateIdentity,
  type IdentityFields,
} from '../identity'
import type { AbrPrefill } from '@/lib/abr/types'

// Synthetic numbers that pass their check digits. Not any entity we deal with.
// ACN 123 456 780; the company's own ABN is 11 + that ACN. 51 824 753 556 is
// the ATO's published example ABN and stands in for a trust's.
const ACN = '123456780'
const COMPANY_ABN = '11123456780'
const TRUST_ABN = '51824753556'
const BAD_CHECKSUM_ABN = '51824753557'

function company(overrides: Partial<IdentityFields> = {}): IdentityFields {
  return {
    entityType: 'company',
    companyName: 'Sample Trading Pty Ltd',
    acnNumber: ACN,
    abnNumber: COMPANY_ABN,
    trustName: '',
    trustAbnNumber: '',
    ...overrides,
  }
}

function trustee(overrides: Partial<IdentityFields> = {}): IdentityFields {
  return {
    entityType: 'trust',
    companyName: 'Sample Holdings Pty Ltd',
    acnNumber: ACN,
    abnNumber: '',
    trustName: 'Sample Family Trust',
    trustAbnNumber: TRUST_ABN,
    ...overrides,
  }
}

describe('validateIdentity — Company', () => {
  it('accepts a company with its own ABN', () => {
    expect(validateIdentity(company())).toEqual({})
  })

  it('requires the name, the ACN and the company ABN', () => {
    const errors = validateIdentity(company({ companyName: ' ', acnNumber: '', abnNumber: '' }))
    expect(Object.keys(errors).sort()).toEqual(['abnNumber', 'acnNumber', 'companyName'])
  })

  it('checks the ACN checksum', () => {
    expect(validateIdentity(company({ acnNumber: '123456789' })).acnNumber).toMatch(/check digit/)
  })

  it('checks the ABN length and checksum', () => {
    expect(validateIdentity(company({ abnNumber: '1112345678' })).abnNumber).toMatch(/11 digits/)
    expect(validateIdentity(company({ abnNumber: BAD_CHECKSUM_ABN })).abnNumber).toMatch(
      /check digits/,
    )
  })

  it("flags a well-formed ABN that doesn't end with the ACN", () => {
    expect(validateIdentity(company({ abnNumber: TRUST_ABN })).abnNumber).toMatch(
      /move it to the trust ABN/,
    )
  })

  it('does not compare against an ACN that is not whole yet', () => {
    const errors = validateIdentity(company({ acnNumber: '1234', abnNumber: TRUST_ABN }))
    expect(errors.acnNumber).toBeTruthy()
    expect(errors.abnNumber).toBeUndefined()
  })

  it('is the same whether or not the manual checkboxes are ticked', () => {
    // Manual mode lives on the form, not on these fields: nothing about it can
    // reach validation. Asserted by validating a form object that carries it.
    const withManual = { ...company({ abnNumber: '' }), companyManual: true, trustManual: true }
    expect(validateIdentity(withManual)).toEqual(validateIdentity(company({ abnNumber: '' })))
  })
})

describe('validateIdentity — the trust on a Company', () => {
  it('is optional', () => {
    expect(validateIdentity(company({ trustName: '', trustAbnNumber: '' }))).toEqual({})
    expect(validateIdentity(company({ trustName: 'Sample Family Trust' }))).toEqual({})
  })

  it('is still checked when a trust ABN is typed', () => {
    expect(validateIdentity(company({ trustAbnNumber: TRUST_ABN }))).toEqual({})
    expect(validateIdentity(company({ trustAbnNumber: BAD_CHECKSUM_ABN })).trustAbnNumber).toMatch(
      /check digits/,
    )
    expect(validateIdentity(company({ trustAbnNumber: COMPANY_ABN })).trustAbnNumber).toMatch(
      /company's own ABN/,
    )
  })
})

describe('validateIdentity — Trust', () => {
  it('accepts a trustee company with no ABN of its own', () => {
    expect(validateIdentity(trustee())).toEqual({})
  })

  it('accepts a trustee company that has its own ABN too', () => {
    expect(validateIdentity(trustee({ abnNumber: COMPANY_ABN }))).toEqual({})
  })

  it('still requires the company name and ACN', () => {
    const errors = validateIdentity(trustee({ companyName: '', acnNumber: '' }))
    expect(errors.companyName).toBeTruthy()
    expect(errors.acnNumber).toBeTruthy()
  })

  it('requires the trust name and trust ABN', () => {
    const errors = validateIdentity(trustee({ trustName: '', trustAbnNumber: '' }))
    expect(errors.trustName).toBeTruthy()
    expect(errors.trustAbnNumber).toBeTruthy()
  })

  it('checks the trust ABN length and checksum', () => {
    expect(validateIdentity(trustee({ trustAbnNumber: '518247535' })).trustAbnNumber).toMatch(
      /11 digits/,
    )
    expect(validateIdentity(trustee({ trustAbnNumber: BAD_CHECKSUM_ABN })).trustAbnNumber).toMatch(
      /check digits/,
    )
  })

  it("rejects a trust ABN that ends with the ACN — that's the company's own", () => {
    expect(validateIdentity(trustee({ trustAbnNumber: COMPANY_ABN })).trustAbnNumber).toMatch(
      /company's own ABN/,
    )
  })

  it("still rejects a company ABN that doesn't end with the ACN", () => {
    expect(validateIdentity(trustee({ abnNumber: TRUST_ABN })).abnNumber).toBeTruthy()
  })
})

describe('canMoveAbnToTrust / moveAbnToTrust', () => {
  it('offers the move for a well-formed ABN that is not the company’s', () => {
    expect(canMoveAbnToTrust(company({ abnNumber: TRUST_ABN }))).toBe(true)
  })

  it('does not offer it for the company’s own ABN, or a malformed one', () => {
    expect(canMoveAbnToTrust(company())).toBe(false)
    expect(canMoveAbnToTrust(company({ abnNumber: BAD_CHECKSUM_ABN }))).toBe(false)
    expect(canMoveAbnToTrust(company({ abnNumber: '' }))).toBe(false)
  })

  it('does not offer it without a whole ACN to compare with', () => {
    expect(canMoveAbnToTrust(company({ acnNumber: '', abnNumber: TRUST_ABN }))).toBe(false)
  })

  it('never offers to overwrite a different trust ABN already there', () => {
    expect(
      canMoveAbnToTrust(trustee({ abnNumber: TRUST_ABN, trustAbnNumber: '83914571673' })),
    ).toBe(false)
    expect(canMoveAbnToTrust(trustee({ abnNumber: TRUST_ABN, trustAbnNumber: TRUST_ABN }))).toBe(
      true,
    )
  })

  it('moves the ABN and offers the trustee entity type to a Company', () => {
    expect(moveAbnToTrust(company({ abnNumber: ` ${TRUST_ABN} ` }))).toEqual({
      patch: { abnNumber: '', trustAbnNumber: TRUST_ABN },
      suggestTrustee: true,
    })
  })

  it('does not re-suggest to a form already set to trustee', () => {
    expect(moveAbnToTrust(trustee({ abnNumber: TRUST_ABN })).suggestTrustee).toBe(false)
  })
})

describe('identityPatchForPick', () => {
  const companyPick: AbrPrefill = {
    entityType: 'company',
    companyName: 'Sample Trading Pty Ltd',
    abnNumber: COMPANY_ABN,
    acnNumber: ACN,
  }
  const trustPick: AbrPrefill = {
    entityType: 'trust',
    trustName: 'Sample Family Trust',
    abnNumber: TRUST_ABN,
  }

  it('company box, a company: name, company ABN and ACN', () => {
    expect(identityPatchForPick('company', companyPick, company())).toEqual({
      patch: { companyName: 'Sample Trading Pty Ltd', abnNumber: COMPANY_ABN, acnNumber: ACN },
      suggestTrustee: false,
    })
  })

  it('company box, a company ABR has no ACN for: the ACN is left alone', () => {
    const { patch } = identityPatchForPick('company', { ...companyPick, acnNumber: undefined }, company())
    expect(patch).not.toHaveProperty('acnNumber')
  })

  it('company box, a trust: goes to the trust, clears the searched text, suggests trustee', () => {
    expect(identityPatchForPick('company', trustPick, company())).toEqual({
      patch: { companyName: '', trustName: 'Sample Family Trust', trustAbnNumber: TRUST_ABN },
      suggestTrustee: true,
    })
  })

  it('company box, a trust: never touches the company ABN or ACN', () => {
    const { patch } = identityPatchForPick('company', trustPick, trustee())
    expect(patch).not.toHaveProperty('abnNumber')
    expect(patch).not.toHaveProperty('acnNumber')
  })

  it('reads a "trustee for" name as a trust even without an entity type', () => {
    const { patch } = identityPatchForPick(
      'company',
      { trustName: 'Sample Family Trust', abnNumber: TRUST_ABN },
      company(),
    )
    expect(patch.trustAbnNumber).toBe(TRUST_ABN)
  })

  it('trust box: trust name and trust ABN only, never a company field', () => {
    for (const pick of [trustPick, companyPick]) {
      const { patch, suggestTrustee } = identityPatchForPick('trust', pick, trustee())
      expect(Object.keys(patch).sort()).toEqual(['trustAbnNumber', 'trustName'])
      expect(suggestTrustee).toBe(false)
    }
  })

  it('never invents a phone, an email or an entity type', () => {
    for (const box of ['company', 'trust'] as const) {
      for (const pick of [trustPick, companyPick]) {
        const { patch } = identityPatchForPick(box, pick, company())
        expect(patch).not.toHaveProperty('phoneNumber')
        expect(patch).not.toHaveProperty('emailAddress')
        expect(patch).not.toHaveProperty('entityType')
      }
    }
  })
})

describe('identityForSave', () => {
  it('trims, keeps the numbers’ spacing, and keeps both ABNs apart', () => {
    expect(
      identityForSave(trustee({ companyName: ' Sample Holdings Pty Ltd ', abnNumber: '11 123 456 780' })),
    ).toEqual({
      entityType: 'trust',
      companyName: 'Sample Holdings Pty Ltd',
      acnNumber: ACN,
      abnNumber: '11 123 456 780',
      trustName: 'Sample Family Trust',
      trustAbnNumber: TRUST_ABN,
    })
  })

  it('keeps a trust typed for a Company — optional there, but saved', () => {
    const saved = identityForSave(company({ trustName: ' Sample Family Trust ', trustAbnNumber: TRUST_ABN }))
    expect(saved.trustName).toBe('Sample Family Trust')
    expect(saved.trustAbnNumber).toBe(TRUST_ABN)
  })
})

describe('atoAbnFor', () => {
  it('prefers the trust ABN when there is one', () => {
    expect(atoAbnFor({ abnNumber: COMPANY_ABN, trustAbnNumber: TRUST_ABN })).toBe(TRUST_ABN)
    expect(atoAbnFor({ abnNumber: '', trustAbnNumber: TRUST_ABN })).toBe(TRUST_ABN)
  })

  it('falls back to the company ABN', () => {
    expect(atoAbnFor({ abnNumber: COMPANY_ABN, trustAbnNumber: '' })).toBe(COMPANY_ABN)
    expect(atoAbnFor({ abnNumber: COMPANY_ABN, trustAbnNumber: null })).toBe(COMPANY_ABN)
    expect(atoAbnFor({ abnNumber: COMPANY_ABN })).toBe(COMPANY_ABN)
  })

  it('is null when neither is recorded', () => {
    expect(atoAbnFor({ abnNumber: null, trustAbnNumber: '  ' })).toBeNull()
    expect(atoAbnFor({})).toBeNull()
  })
})
