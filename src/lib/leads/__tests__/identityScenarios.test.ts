import { describe, it, expect } from 'vitest'
import {
  emptyConversionForm,
  identityOf,
  toCompanyDetails,
  validateConversion,
  type ConversionForm,
} from '../conversionForm'
import {
  commitChange,
  withAbnMovedToTrust,
  withAsicChoice,
  withEntityType,
  withExtract,
  withoutExtract,
  withPick,
} from '@/lib/clients/identityForm'
import { acnDiffers, pendingIdentityChoices } from '@/lib/asic/fill'
import { canMoveAbnToTrust } from '@/lib/clients/identity'
import { acnToLookUp } from '@/lib/abr/acnAbn'
import { candidateAbnsForAcn } from '@/lib/asic/identifiers'
import type { AsicExtract } from '@/lib/asic/types'
import type { AbrPrefill } from '@/lib/abr/types'

/**
 * Every company / trust combination, end to end through the same pure steps
 * the forms run: an ASIC extract, a register pick in either box, the move
 * action, undo, validation and the saved shape.
 *
 * Synthetic throughout. ACN 123 456 780 with its own ABN 11 123 456 780; ACN
 * 000 000 019 (ASIC's published example) for "another company"; 51 824 753 556
 * (the ATO's published example) for the trust's ABN.
 */

const ACN = '123456780'
const COMPANY_ABN = '11123456780'
const TRUST_ABN = '51824753556'
const OTHER_ACN = '000000019'
const OTHER_ABN = candidateAbnsForAcn(OTHER_ACN)[0]

const COMPANY_EXTRACT: AsicExtract = {
  companyName: 'SAMPLE TRADING PTY LTD',
  acn: ACN,
  abn: COMPANY_ABN,
  status: 'Registered',
  registeredOffice: 'Unit 1, 10 Sample Road, North Melbourne VIC 3051',
  principalPlaceOfBusiness: 'Level 2, 20 Example Street, Sampleton NSW 2000',
  directors: [{ name: 'Jane Sample', dateOfBirth: '1970-03-14' }],
  extractType: 'current',
  extractedAt: '2026-09-23T14:07:38+10:00',
  warnings: [],
}

/** A company that only acts as trustee: its extract has no ABN line. */
const TRUSTEE_EXTRACT: AsicExtract = { ...COMPANY_EXTRACT, abn: null, warnings: ['This extract shows no ABN.'] }

const COMPANY_PICK: AbrPrefill = {
  entityType: 'company',
  companyName: 'Sample Trading Pty Ltd',
  abnNumber: COMPANY_ABN,
  acnNumber: ACN,
}

const TRUST_PICK: AbrPrefill = {
  entityType: 'trust',
  trustName: 'Sample Family Trust',
  abnNumber: TRUST_ABN,
}

function blank(overrides: Partial<ConversionForm> = {}): ConversionForm {
  return {
    ...emptyConversionForm(null),
    name: 'Jane Sample',
    email: 'jane@example.com',
    ...overrides,
  }
}

describe('company with its own ABN, no trust', () => {
  it('PDF then ABR: the extract fills, the pick agrees, it validates', () => {
    const afterPdf = withExtract(blank(), COMPANY_EXTRACT)
    expect(afterPdf.suggestTrustee).toBe(false)
    expect(identityOf(afterPdf.form)).toMatchObject({
      companyName: 'Sample Trading Pty Ltd',
      acnNumber: ACN,
      abnNumber: COMPANY_ABN,
    })

    // The pick's ACN is the extract's — nothing to warn about.
    expect(acnDiffers(COMPANY_PICK.acnNumber!, afterPdf.form.asicFill!.acn)).toBe(false)
    const afterPick = withPick(afterPdf.form, 'company', COMPANY_PICK)
    expect(afterPick.suggestTrustee).toBe(false)
    expect(validateConversion(afterPick.form)).toEqual({})
  })

  it('ABR then PDF: every identity field "matches the ASIC extract"', () => {
    const afterPick = withPick(blank(), 'company', COMPANY_PICK).form
    const afterPdf = withExtract(afterPick, COMPANY_EXTRACT).form
    const fields = afterPdf.asicFill!.identity!.fields
    expect(fields.companyName.status).toBe('matches')
    expect(fields.acnNumber.status).toBe('matches')
    expect(fields.abnNumber.status).toBe('matches')
    expect(pendingIdentityChoices(afterPdf.asicFill)).toEqual([])
    expect(validateConversion(afterPdf)).toEqual({})
  })

  it('saves the company ABN and no trust', () => {
    const form = withExtract(blank(), COMPANY_EXTRACT).form
    expect(toCompanyDetails(form)).toMatchObject({
      entityType: 'company',
      abnNumber: COMPANY_ABN,
      trustName: '',
      trustAbnNumber: '',
    })
  })
})

describe('trustee company with no ABN of its own, plus the trust', () => {
  it('the extract leaves the company ABN alone and offers the trustee type', () => {
    const { form, suggestTrustee } = withExtract(blank(), TRUSTEE_EXTRACT)
    expect(suggestTrustee).toBe(true)
    expect(form.entityType).toBe('company') // offered, never switched
    expect(form.abnNumber).toBe('')
    expect(form.asicFill!.identity!.noAbn).toBe(true)
    expect(form.asicFill!.identity!.fields.abnNumber.status).toBe('not_on_extract')
  })

  it('switched to trustee, the trust is picked in the trust box, and it validates', () => {
    const afterPdf = withExtract(blank(), TRUSTEE_EXTRACT).form
    const trustee = { ...afterPdf, entityType: 'trust' as const }
    const { form } = withPick(trustee, 'trust', TRUST_PICK)
    expect(form.companyName).toBe('Sample Trading Pty Ltd')
    expect(form.trustName).toBe('Sample Family Trust')
    expect(form.trustAbnNumber).toBe(TRUST_ABN)
    expect(form.abnNumber).toBe('')
    expect(validateConversion(form)).toEqual({})
    expect(toCompanyDetails(form)).toMatchObject({ abnNumber: '', trustAbnNumber: TRUST_ABN })
  })

  it('a Company with no ABN does not validate — the company ABN is required there', () => {
    const { form } = withExtract(blank(), TRUSTEE_EXTRACT)
    expect(validateConversion(form).abnNumber).toBeTruthy()
  })
})

describe('trustee company with its own ABN, plus the trust', () => {
  it('keeps both ABNs, separately', () => {
    const afterPdf = withExtract(blank({ entityType: 'trust' }), COMPANY_EXTRACT)
    expect(afterPdf.suggestTrustee).toBe(false)
    const { form } = withPick(afterPdf.form, 'trust', TRUST_PICK)
    expect(validateConversion(form)).toEqual({})
    expect(toCompanyDetails(form)).toMatchObject({
      entityType: 'trust',
      abnNumber: COMPANY_ABN,
      trustAbnNumber: TRUST_ABN,
    })
  })
})

describe('a trust picked from the company box', () => {
  it('goes to the trust section; company fields untouched; searched text cleared', () => {
    const afterPdf = withExtract(blank(), COMPANY_EXTRACT).form
    const searching = { ...afterPdf, companyName: 'Sample Fam' }
    const { form, suggestTrustee } = withPick(searching, 'company', TRUST_PICK)
    expect(suggestTrustee).toBe(true)
    expect(form.companyName).toBe('')
    expect(form.acnNumber).toBe(ACN)
    expect(form.abnNumber).toBe(COMPANY_ABN)
    expect(form.trustName).toBe('Sample Family Trust')
    expect(form.trustAbnNumber).toBe(TRUST_ABN)
  })
})

describe('a trust ABN typed into the company ABN field', () => {
  it('is an error with a move fix; moving it offers trustee and then validates', () => {
    const typed = blank({ companyName: 'Sample Holdings Pty Ltd', acnNumber: ACN, abnNumber: TRUST_ABN })
    expect(validateConversion(typed).abnNumber).toMatch(/move it to the trust ABN/)
    expect(canMoveAbnToTrust(identityOf(typed))).toBe(true)

    const moved = withAbnMovedToTrust(typed)
    expect(moved.suggestTrustee).toBe(true)
    expect(moved.form.abnNumber).toBe('')
    expect(moved.form.trustAbnNumber).toBe(TRUST_ABN)

    const accepted = { ...moved.form, entityType: 'trust' as const, trustName: 'Sample Family Trust' }
    expect(validateConversion(accepted)).toEqual({})
  })
})

describe('extract for a different ACN than the form', () => {
  const typed = blank({ companyName: 'Other Co Pty Ltd', acnNumber: OTHER_ACN, abnNumber: OTHER_ABN })

  it('is noticed before anything fills', () => {
    expect(acnDiffers(typed.acnNumber, COMPANY_EXTRACT.acn)).toBe(true)
  })

  it('[Replace company details with the extract’s]: name, ACN and ABN replaced', () => {
    const { form } = withExtract(typed, COMPANY_EXTRACT, 'replace')
    expect(identityOf(form)).toMatchObject({
      companyName: 'Sample Trading Pty Ltd',
      acnNumber: ACN,
      abnNumber: COMPANY_ABN,
    })
    expect(validateConversion(form)).toEqual({})
  })

  it('replacing with an extract that has no ABN clears the other company’s ABN', () => {
    const { form, suggestTrustee } = withExtract(typed, TRUSTEE_EXTRACT, 'replace')
    expect(form.abnNumber).toBe('')
    expect(suggestTrustee).toBe(true)
  })

  it('undo after replacing puts the other company back', () => {
    const { form } = withExtract(typed, COMPANY_EXTRACT, 'replace')
    expect(identityOf(withoutExtract(form))).toEqual(identityOf(typed))
  })

  it('[Cancel]: nothing is applied, so the form is exactly as typed', () => {
    // Cancel never calls withExtract; this pins that the form object is the
    // only state, with no fill riding along.
    expect(typed.asicFill).toBeNull()
  })
})

describe('extract with no ABN line', () => {
  it('leaves a typed company ABN untouched', () => {
    const typed = blank({ abnNumber: COMPANY_ABN })
    const { form } = withExtract(typed, TRUSTEE_EXTRACT)
    expect(form.abnNumber).toBe(COMPANY_ABN)
    expect(form.asicFill!.identity!.noAbn).toBe(true)
  })
})

describe('a filled field the extract disagrees with', () => {
  const typed = blank({ companyName: 'Sample Trading Co', acnNumber: ACN })

  it('asks rather than overwriting', () => {
    const { form } = withExtract(typed, COMPANY_EXTRACT)
    expect(form.companyName).toBe('Sample Trading Co')
    expect(form.asicFill!.identity!.fields.companyName).toEqual({
      status: 'differs',
      asic: 'Sample Trading Pty Ltd',
      form: 'Sample Trading Co',
    })
    expect(pendingIdentityChoices(form.asicFill)).toEqual(['companyName'])
  })

  it('Use ASIC puts the extract’s value in; Keep leaves the form’s', () => {
    const { form } = withExtract(typed, COMPANY_EXTRACT)
    const used = withAsicChoice(form, 'companyName', 'asic')
    expect(used.companyName).toBe('Sample Trading Pty Ltd')
    expect(pendingIdentityChoices(used.asicFill)).toEqual([])

    const kept = withAsicChoice(form, 'companyName', 'keep')
    expect(kept.companyName).toBe('Sample Trading Co')
    expect(kept.asicFill!.identity!.fields.companyName.status).toBe('kept')
  })

  it('reads "Proprietary Limited" and spacing as the same name', () => {
    const { form } = withExtract(
      blank({ companyName: 'Sample  Trading Proprietary Limited' }),
      COMPANY_EXTRACT,
    )
    expect(form.asicFill!.identity!.fields.companyName.status).toBe('matches')
  })

  it('compares numbers by digits, whatever the spacing', () => {
    const { form } = withExtract(blank({ acnNumber: '123 456 780' }), COMPANY_EXTRACT)
    expect(form.asicFill!.identity!.fields.acnNumber.status).toBe('matches')
    expect(form.acnNumber).toBe('123 456 780')
  })
})

describe('manual mode', () => {
  it('the PDF fills exactly the same with "Enter manually" ticked', () => {
    const manual = withExtract(blank({ companyManual: true, trustManual: true }), COMPANY_EXTRACT).form
    const searching = withExtract(blank(), COMPANY_EXTRACT).form
    expect(identityOf(manual)).toEqual(identityOf(searching))
  })

  it('ticking the company box stops the ABN-by-ACN check; the trust box does not', () => {
    const companyTicked: ConversionForm = blank({ acnNumber: ACN, companyManual: true })
    const trustTicked: ConversionForm = blank({ acnNumber: ACN, trustManual: true })
    expect(acnToLookUp(companyTicked, new Set())).toBeNull()
    expect(acnToLookUp(trustTicked, new Set())).toBe(ACN)
  })

  it('validation is the same either way', () => {
    const form = blank({ companyName: 'Sample Trading Pty Ltd', acnNumber: ACN, abnNumber: TRUST_ABN })
    expect(validateConversion({ ...form, companyManual: true, trustManual: true })).toEqual(
      validateConversion(form),
    )
  })
})

describe('undo', () => {
  it('restores every field the fill set, identity included', () => {
    const typed = blank({ registeredOfficeAddress: '1 Typed Street' })
    const { form } = withExtract(typed, COMPANY_EXTRACT)
    const undone = withoutExtract(form)
    expect(identityOf(undone)).toEqual(identityOf(typed))
    expect(undone.registeredOfficeAddress).toBe('1 Typed Street')
    expect(undone.directors).toEqual([])
    expect(undone.asicFill).toBeNull()
  })

  it('restores a value replaced by "Use ASIC"', () => {
    const typed = blank({ companyName: 'Sample Trading Co' })
    const used = withAsicChoice(withExtract(typed, COMPANY_EXTRACT).form, 'companyName', 'asic')
    expect(withoutExtract(used).companyName).toBe('Sample Trading Co')
  })

  it('never touches the trust fields', () => {
    const typed = blank({ entityType: 'trust', trustName: 'Sample Family Trust', trustAbnNumber: TRUST_ABN })
    const filledIn = withExtract(typed, COMPANY_EXTRACT).form
    expect(filledIn.trustName).toBe('Sample Family Trust')
    expect(filledIn.trustAbnNumber).toBe(TRUST_ABN)
    expect(withoutExtract(filledIn).trustAbnNumber).toBe(TRUST_ABN)
  })

  it('a second extract replaces the first, and undo still returns to what was typed', () => {
    const typed = blank()
    const first = withExtract(typed, TRUSTEE_EXTRACT).form
    const second = withExtract(first, COMPANY_EXTRACT).form
    expect(second.abnNumber).toBe(COMPANY_ABN)
    expect(identityOf(withoutExtract(second))).toEqual(identityOf(typed))
  })
})

describe('an ABR pick against an applied extract', () => {
  it('notices a picked ACN that is not the extract’s', () => {
    const { form } = withExtract(blank(), COMPANY_EXTRACT)
    const otherPick: AbrPrefill = { ...COMPANY_PICK, acnNumber: OTHER_ACN, abnNumber: OTHER_ABN }
    expect(acnDiffers(otherPick.acnNumber!, form.asicFill!.acn)).toBe(true)
  })
})

describe('the trustee offer', () => {
  it('is recorded with its reason, and never switches the entity type', () => {
    const form = commitChange(withExtract(blank(), TRUSTEE_EXTRACT), 'no_abn')
    expect(form.trusteeOffer).toBe('no_abn')
    expect(form.entityType).toBe('company')
  })

  it('is answered by choosing an entity type', () => {
    const offered = commitChange(withPick(blank(), 'company', TRUST_PICK), 'trust_pick')
    expect(offered.trusteeOffer).toBe('trust_pick')
    const switched = withEntityType(offered, 'trust')
    expect(switched.entityType).toBe('trust')
    expect(switched.trusteeOffer).toBeNull()
  })

  it('an offer made only by the extract goes when the extract is undone', () => {
    const form = commitChange(withExtract(blank(), TRUSTEE_EXTRACT), 'no_abn')
    expect(withoutExtract(form).trusteeOffer).toBeNull()
    // A later reason replaces the earlier one, so undoing the extract after a
    // trust pick keeps the pick's offer.
    const picked = commitChange(withPick(form, 'company', TRUST_PICK), 'trust_pick')
    expect(picked.trusteeOffer).toBe('trust_pick')
    expect(withoutExtract(picked).trusteeOffer).toBe('trust_pick')
  })

  it('a change that implies nothing leaves the state as it was', () => {
    const form = commitChange(withPick(blank(), 'company', COMPANY_PICK), 'trust_pick')
    expect(form.trusteeOffer).toBeNull()
  })
})
