import { describe, expect, it } from 'vitest'
import { creditorRows, prefillForm, subjectsFor } from '../prefill'
import { splitAddress } from '../address'
import { LODGEMENT_DEFAULTS, missingSettings, readCvlSettings, settingValue } from '../settings'
import { handwrittenKeys } from '@/lib/forms/registry'
import { context } from './fixtures'

/** The CVL entry screens' pre-fill. Synthetic client file only (fixtures.ts). */

const value = (p: ReturnType<typeof prefillForm>, key: string) => p.fields[key]?.value

describe('splitAddress', () => {
  it('splits an Australian address into the forms’ four boxes', () => {
    expect(splitAddress('Unit 1, 10 Sample Road, North Melbourne VIC 3051')).toEqual({
      street: 'Unit 1, 10 Sample Road',
      suburb: 'North Melbourne',
      state: 'VIC',
      postcode: '3051',
    })
    expect(splitAddress('PO Box 100, Sampletown NSW 2000, Australia')).toEqual({ street: 'PO Box 100', suburb: 'Sampletown', state: 'NSW', postcode: '2000' })
  })

  it('puts what it cannot split in the street box, and nothing for nothing', () => {
    expect(splitAddress('Somewhere without a postcode')).toEqual({ street: 'Somewhere without a postcode', suburb: '', state: '', postcode: '' })
    expect(splitAddress('  ')).toBeNull()
  })
})

describe('CVL settings', () => {
  it('has no External Administrator until given, and nothing confirmed', () => {
    const s = readCvlSettings([])
    expect(s.externalAdministrator).toEqual({})
    expect(s.placements).toEqual({})
    expect(Object.values(s.confirmed).every((c) => c === false)).toBe(true)
    expect(missingSettings(s)).toContain('External Administrator: Name of External Administrator')
    // The extra address line and the number "if applicable" are not asked for.
    expect(missingSettings(s).join(' ')).not.toMatch(/Address \(office|Liquidator number/)
  })

  it('reads stored values, and ignores what it does not know', () => {
    const at = '2026-10-29T00:00:00Z'
    const s = readCvlSettings([
      { key: 'external_administrator', value: { name: 'Alex Liquidator', phone: ' ', bogus: 'x' }, confirmed: true, updated_by: 'Casey', updated_at: at },
      { key: 'f509_place.super_payable', value: 'r3', confirmed: false, updated_by: 'Casey', updated_at: at },
      { key: 'f509_place.director_loan', value: 'r9', confirmed: false, updated_by: 'Casey', updated_at: at },
    ])
    expect(s.externalAdministrator).toEqual({ name: 'Alex Liquidator' })
    expect(s.confirmed.external_administrator).toBe(true)
    expect(s.placements).toEqual({ super_payable: 'r3' })
  })

  it('checks a value against its setting', () => {
    expect(settingValue('f509_place.unsecured_creditors', 'r6')).toBe('r6')
    expect(() => settingValue('f509_place.unsecured_creditors', 'b_val')).toThrow()
    expect(settingValue('external_administrator', { name: ' A ', phone: '' })).toEqual({ name: 'A' })
    expect(settingValue('external_administrator', null)).toBeNull()
  })
})

describe('Form 509', () => {
  it('fills no amount: the summary is typed (pre-fill only from the ASIC extract and the CVL settings)', () => {
    const p = prefillForm('509', 'company', context())
    const amounts = Object.keys(p.fields).filter((k) => /_(val|erv)$|^r\d|^total|^share/.test(k))
    expect(amounts).toEqual([])
    // What is filled: the company (ASIC extract), the lodgement details (CVL settings) and the signer.
    expect(Object.keys(p.fields).sort()).toEqual(
      ['capacity', 'company_acn', 'company_name', 'contact_name', 'email', 'entity_name', 'phone', 'postal_1', 'postal_2', 'signer_name'].sort(),
    )
  })

  it('always fills the lodgement details from the settings: their starting values until changed', () => {
    const p = prefillForm('509', 'company', context())
    const value = (k: string) => p.fields[k]?.value
    expect(value('entity_name')).toBe(LODGEMENT_DEFAULTS.firm)
    expect(value('contact_name')).toBe(LODGEMENT_DEFAULTS.contactName)
    expect(value('phone')).toBe(LODGEMENT_DEFAULTS.phone)
    expect(value('email')).toBe(LODGEMENT_DEFAULTS.email)
    expect(value('postal_1')).toBe(LODGEMENT_DEFAULTS.postal1)
    expect(value('postal_2')).toBe(LODGEMENT_DEFAULTS.postal2)
    // Not on the form MCR lodges with: blank until set.
    expect(p.fields.entity_number).toBeUndefined()
    expect(p.fields.agent_number).toBeUndefined()
    // Each says where it came from.
    expect(p.fields.entity_name?.source.from.join(' ')).toMatch(/Form 509 lodgement details/)
    // The liquidator and MCR company settings are not Form 509's: no warning about them here.
    expect(p.warnings.join(' ')).not.toMatch(/Not set yet in CVL settings/)
    expect(p.fields.summary_date).toBeUndefined()
  })

  it('uses the lodgement details as changed on the settings page, and their starting values again once cleared', () => {
    const row = (value: unknown) => ({ key: 'lodgement', value: value as never, confirmed: false, updated_by: 'staff', updated_at: '2026-11-04T00:00:00Z' })
    const changed = prefillForm('509', 'company', context({ settings: readCvlSettings([row({ firm: 'Example Advisory', phone: '02 0000 0000' })]) }))
    expect(changed.fields.entity_name?.value).toBe('Example Advisory')
    expect(changed.fields.phone?.value).toBe('02 0000 0000')
    // Saved without them: those boxes are blank, not the starting values.
    expect(changed.fields.contact_name).toBeUndefined()
    const cleared = prefillForm('509', 'company', context({ settings: readCvlSettings([row(null)]) }))
    expect(cleared.fields.entity_name?.value).toBe(LODGEMENT_DEFAULTS.firm)
  })

  it('lists the statement amounts beside the form, to type from, and puts none in a box', () => {
    const p = prefillForm('509', 'company', context())
    const c = Object.fromEntries(p.candidates.map((x) => [x.key, x]))
    expect(c.director_loan).toMatchObject({ amount: 4000, target: null })
    expect(c.financed_vehicles).toMatchObject({ amount: 18500, target: null })
    expect(c.super_payable).toMatchObject({ amount: 6400, target: null })
    // ATO 172,320.55 + trade 5,000 + business loan 7,000 + owner funds 2,500 + landlord 3,300
    expect(c.unsecured_creditors).toMatchObject({ amount: 190120.55, target: null })
    for (const key of ['h_val', 's2_val', 'r3', 'r6', 'r7_claims']) expect(p.fields[key]).toBeUndefined()
  })

  it('puts no amount in a box even when a placement setting is set: amounts are typed', () => {
    const settings = readCvlSettings([{ key: 'f509_place.super_payable', value: 'r3', confirmed: false, updated_by: 'Casey', updated_at: '2026-10-29T00:00:00Z' }])
    const p = prefillForm('509', 'company', context({ settings }))
    expect(p.fields.r3).toBeUndefined()
    expect(p.candidates.find((c) => c.key === 'super_payable')).toMatchObject({ amount: 6400 })
  })

  it('fills the signer from the first director, never the date signed', () => {
    const p = prefillForm('509', 'company', context())
    expect(value(p, 'signer_name')).toBe('Jordan Sample')
    expect(p.fields.date_signed).toBeUndefined()
  })
})

describe('Part A', () => {
  it('ticks the CVL appointment and fills the company from the ASIC extract, with a link to its page', () => {
    const p = prefillForm('507a', 'company', context())
    expect(value(p, 'ea_role')).toBe('cvl_liquidator')
    expect(value(p, 'company_name')).toBe('Example Trading Pty Ltd')
    expect(value(p, 'a3_registered_suburb')).toBe('North Melbourne')
    expect(value(p, 'a3_principal_postcode')).toBe('2000')
    expect(p.fields.company_name.source.link).toEqual({ kind: 'href', href: '/api/admin/clients/cl_1/asic-extract/ex-1?page=1', label: 'Open the ASIC extract at page 1' })
    expect(p.fields.company_name.source.from[1]).toBe('ASIC extract dated 23 September 2026.')
  })

  it('fills the External Administrator box, box for box, from its one setting', () => {
    const ea = {
      organisation: 'Example Insolvency Pty Ltd',
      liquidatorNumber: '123456',
      name: 'Alex Liquidator',
      contact: 'Sam Contact',
      phone: '02 0000 0000',
      address: 'Level 1',
      street: '10 Sample Street',
      suburb: 'Sydney',
      state: 'NSW',
      postcode: '2000',
    }
    const settings = readCvlSettings([{ key: 'external_administrator', value: ea, confirmed: false, updated_by: 'staff', updated_at: '2026-11-04T00:00:00Z' }])
    const p = prefillForm('507a', 'company', context({ settings }))
    const boxes = {
      ea_organisation: ea.organisation,
      ea_liquidator_number: ea.liquidatorNumber,
      ea_name: ea.name,
      ea_contact: ea.contact,
      ea_phone: ea.phone,
      ea_address: ea.address,
      ea_street: ea.street,
      ea_suburb: ea.suburb,
      ea_state: ea.state,
      ea_postcode: ea.postcode,
    }
    for (const [key, expected] of Object.entries(boxes)) expect(value(p, key), key).toBe(expected)
    expect(p.fields.ea_name.source.from.join(' ')).toMatch(/CVL settings: External Administrator/)
    expect(p.warnings.join(' ')).not.toMatch(/Not set yet/)
  })

  it('leaves the External Administrator box blank until set, and says which boxes', () => {
    const p = prefillForm('507a', 'company', context())
    expect(p.fields.ea_name).toBeUndefined()
    expect(p.warnings.join(' ')).toMatch(/Not set yet in CVL settings: External Administrator: Organisation/)
  })

  it('fills "commenced trading" with the registration date, saying it is the registration date', () => {
    const p = prefillForm('507a', 'company', context())
    expect(value(p, 'a3_commenced')).toBe('2014-06-12')
    expect(p.fields.a3_commenced.source.rule).toMatch(/after registration/)
  })

  it('asks for the ASIC extract again when there is no registration date and none kept', () => {
    const ctx = context({ asicExtract: null })
    ctx.company!.registrationDate = null
    const p = prefillForm('507a', 'company', ctx)
    expect(p.fields.a3_commenced).toBeUndefined()
    expect(p.notes.a3_commenced).toBe('Upload the ASIC extract again to fill (the company’s registration date).')
  })

  it('pre-fills no table and no trust answer: A4 to A7 are typed (only the ASIC extract and the CVL settings pre-fill)', () => {
    const ctx = context()
    ctx.company!.entityType = 'trust'
    ctx.company!.trustName = 'Example Family Trust'
    const p = prefillForm('507a', 'company', ctx)
    expect(p.tables).toEqual({})
    expect(p.fields.a3_trustee).toBeUndefined()
    expect(p.fields.a3_trust_name).toBeUndefined()
    // The client file's creditors are still worked out (Form 509's "amounts to place" list uses them).
    expect(creditorRows(context()).length).toBeGreaterThan(0)
  })

  it('fills the declaration name from the first director (ASIC extract), never the tables\u2019 "signed by"', () => {
    const p = prefillForm('507a', 'company', context())
    expect(value(p, 'a9_name')).toBe('Jordan Sample')
    // The client signs and names themselves on the appendix tables by hand.
    expect(p.signedBy).toBeNull()
  })
})

describe('Part B', () => {
  it('fills each director’s own Part B from the ASIC extract, and no phone or email from the client file', () => {
    const one = prefillForm('507b', 'director:1', context())
    expect(value(one, 'b1_name')).toBe('Jordan Sample')
    expect(one.fields.b1_phone).toBeUndefined()
    expect(one.fields.b1_email).toBeUndefined()
    expect(one.fields.b1_name.source.from[0]).toBe('Director: Jordan Sample, born 1970-03-14, appointed 2016-08-05.')

    const two = prefillForm('507b', 'director:2', context())
    expect(value(two, 'b1_name')).toBe('Casey Example')
    expect(two.notes.b1_role).toBe('The kept ASIC extract has no appointment date for this director.')
  })

  it('writes B10 as DD/MM/YYYY (a plain text box), and leaves B24 (the accountant) to be typed', () => {
    const p = prefillForm('507b', 'director:1', context())
    expect(value(p, 'b10_date')).toBe('12/06/2014')
    expect(p.fields.b24_name).toBeUndefined()
    expect(p.fields.b24_phone).toBeUndefined()
    expect(p.notes.b24_name).toBeUndefined()
  })

  it('never pre-fills anything written by hand', () => {
    for (const [code, subject] of [['509', 'company'], ['507a', 'company'], ['507b', 'director:1']] as const) {
      const p = prefillForm(code, subject, context())
      for (const key of handwrittenKeys(code)) expect(p.fields[key], `${code} ${key}`).toBeUndefined()
    }
  })
})

describe('subjectsFor', () => {
  it('gives every director their own Part B, and one Part A and Form 509 per company', () => {
    expect(subjectsFor('507b', { directors: 2 })).toEqual(['director:1', 'director:2'])
    expect(subjectsFor('507b', { directors: 0 })).toEqual(['director:1'])
    expect(subjectsFor('507a', { directors: 3 })).toEqual(['company'])
    expect(subjectsFor('509', { directors: 3 })).toEqual(['company'])
  })
})

describe('creditors when an ATO account cannot be read', () => {
  it('never puts the balance sheet ATO figure in place of an ATO account whose dates could not be read', () => {
    const ctx = context()
    ctx.atoAccounts = {
      accounts: [{ id: 'a1', documentId: 'doc-ica', kind: 'activity_statement', label: 'Activity statement 001', balance: null, balanceDate: null, needsReview: false, reviewedAt: null, entityMatches: true, olderFiles: 0, unparsedDateRows: 630 }],
      totalDebt: null,
      unreadable: [{ label: 'Activity statement 001', rows: 630 }],
    }
    const ato = creditorRows(ctx).filter((r) => r.row.name === 'Australian Taxation Office' || /BAS Payable/.test(JSON.stringify(r.source)))
    expect(ato).toEqual([])
    // With no ATO account on file at all, the balance sheet's line is used, as before.
    const none = context()
    none.atoAccounts = { accounts: [], totalDebt: null, unreadable: [] }
    expect(creditorRows(none).some((r) => /BAS Payable/.test(JSON.stringify(r.source)))).toBe(true)
  })
})
