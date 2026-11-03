import { describe, expect, it } from 'vitest'
import { creditorRows, prefillForm, subjectsFor } from '../prefill'
import { splitAddress } from '../address'
import { missingSettings, readCvlSettings, settingValue } from '../settings'
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
  it('has no defaults, and nothing confirmed', () => {
    const s = readCvlSettings([])
    expect(s.mcrCompany).toEqual({})
    expect(s.liquidator).toEqual({})
    expect(s.placements).toEqual({})
    expect(Object.values(s.confirmed).every((c) => c === false)).toBe(true)
    expect(missingSettings(s)).toContain('Liquidator name')
  })

  it('reads stored values, and ignores what it does not know', () => {
    const at = '2026-10-29T00:00:00Z'
    const s = readCvlSettings([
      { key: 'liquidator', value: { name: 'Alex Liquidator', phone: ' ', bogus: 'x' }, confirmed: true, updated_by: 'Casey', updated_at: at },
      { key: 'f509_place.super_payable', value: 'r3', confirmed: false, updated_by: 'Casey', updated_at: at },
      { key: 'f509_place.director_loan', value: 'r9', confirmed: false, updated_by: 'Casey', updated_at: at },
    ])
    expect(s.liquidator).toEqual({ name: 'Alex Liquidator' })
    expect(s.confirmed.liquidator).toBe(true)
    expect(s.placements).toEqual({ super_payable: 'r3' })
  })

  it('checks a value against its setting', () => {
    expect(settingValue('f509_place.unsecured_creditors', 'r6')).toBe('r6')
    expect(() => settingValue('f509_place.unsecured_creditors', 'b_val')).toThrow()
    expect(settingValue('liquidator', { name: ' A ', email: '' })).toEqual({ name: 'A' })
    expect(settingValue('mcr_company', null)).toBeNull()
  })
})

describe('Form 509', () => {
  it('puts the book values in the valuation column only, with their printed lines as the source', () => {
    const p = prefillForm('509', 'company', context())
    expect(value(p, 'b_val')).toBe(12480.5)
    expect(value(p, 'c_val')).toBe(150)
    expect(value(p, 'd_val')).toBe(3204.17)
    expect(value(p, 'e_val')).toBe(8900)
    expect(value(p, 'g_val')).toBe(22500)
    expect(value(p, 'share_issued')).toBe(100)
    for (const erv of ['a_erv', 'b_erv', 'c_erv', 'd_erv', 'e_erv', 'g_erv', 'h_erv', 's2_erv', 'total_erv']) expect(p.fields[erv]).toBeUndefined()
    expect(p.fields.b_val.source.from.join(' ')).toContain('“Trade Debtors” printed 12,480.50 — page 2 of fy26.pdf')
    expect(p.fields.b_val.source.link).toEqual({ kind: 'pdf', documentId: 'doc-fy26', page: 2 })
  })

  it('leaves MCR and liquidator details blank until set, and says so', () => {
    const p = prefillForm('509', 'company', context())
    for (const key of ['contact_name', 'entity_name', 'entity_number', 'phone', 'email', 'postal_1']) expect(p.fields[key]).toBeUndefined()
    expect(p.warnings.join(' ')).toMatch(/Not set yet in CVL settings: /)
    expect(p.fields.summary_date).toBeUndefined()
  })

  it('lists the amounts not placed beside the form, and places none without a setting', () => {
    const p = prefillForm('509', 'company', context())
    const c = Object.fromEntries(p.candidates.map((x) => [x.key, x]))
    expect(c.director_loan).toMatchObject({ amount: 4000, target: null })
    expect(c.financed_vehicles).toMatchObject({ amount: 18500, target: null })
    expect(c.super_payable).toMatchObject({ amount: 6400, target: null })
    // ATO 172,320.55 + trade 5,000 + business loan 7,000 + owner funds 2,500 + landlord 3,300
    expect(c.unsecured_creditors).toMatchObject({ amount: 190120.55, target: null })
    for (const key of ['h_val', 's2_val', 'r3', 'r6', 'r7_claims']) expect(p.fields[key]).toBeUndefined()
  })

  it('places an amount once its setting says where, and says so', () => {
    const settings = readCvlSettings([{ key: 'f509_place.super_payable', value: 'r3', confirmed: false, updated_by: 'Casey', updated_at: '2026-10-29T00:00:00Z' }])
    const p = prefillForm('509', 'company', context({ settings }))
    expect(value(p, 'r3')).toBe(6400)
    expect(p.fields.r3.source.from.at(-1)).toBe('Placed in 3 Preferential creditors by the CVL setting.')
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

  it('lists the creditors: each ATO account owing, the balance sheet’s lines and the SBR’s own rows', () => {
    const rows = creditorRows(context())
    expect(rows.map((r) => [r.row.name, r.row.amount, !!r.row.secured, !!r.row.related])).toEqual([
      ['Australian Taxation Office', 172320.55, false, false],
      ['Australian Taxation Office', 6400, false, false],
      // The ATO accounts stand in for the BAS Payable line; the income tax credit is not a debt.
      ['Trade Creditors', 5000, false, false],
      ['Chattel Mortgage - Ute', 18500, true, false],
      ['Business Loan', 7000, false, false],
      ['Owner Funds Introduced', 2500, false, true],
      // "Trade suppliers" on the SBR is the balance-sheet hint, already listed.
      ['Sample Landlord Pty Ltd', 3300, false, false],
    ])
    const p = prefillForm('507a', 'company', context())
    expect(p.tables.A7).toHaveLength(7)
  })

  it('describes the assets in A4 without copying book values into the director’s estimate', () => {
    const p = prefillForm('507a', 'company', context())
    expect(p.tables.A4.map((r) => r.row)).toEqual([
      { description: 'Cash at Bank' },
      { description: 'Petty Cash' },
      { description: 'Trade Debtors' },
      { description: 'Stock on Hand' },
      { description: 'Plant and Equipment' },
    ])
  })

  it('answers the trust question from the file, and the declaration name from the first director', () => {
    const ctx = context()
    ctx.company!.entityType = 'trust'
    ctx.company!.trustName = 'Example Family Trust'
    const p = prefillForm('507a', 'company', ctx)
    expect(value(p, 'a3_trustee')).toBe('yes')
    expect(value(p, 'a3_trust_name')).toBe('Example Family Trust')
    expect(value(p, 'a9_name')).toBe('Jordan Sample')
    expect(p.signedBy?.value).toBe('Jordan Sample')
  })
})

describe('Part B', () => {
  it('fills each director’s own Part B, with the client’s phone and email only for the client', () => {
    const one = prefillForm('507b', 'director:1', context())
    expect(value(one, 'b1_name')).toBe('Jordan Sample')
    expect(value(one, 'b1_phone')).toBe('0400 000 001')
    expect(value(one, 'b1_email')).toBe('jordan@example.test')
    expect(one.fields.b1_name.source.from[0]).toBe('Director: Jordan Sample, born 1970-03-14, appointed 2016-08-05.')

    const two = prefillForm('507b', 'director:2', context())
    expect(value(two, 'b1_name')).toBe('Casey Example')
    expect(two.fields.b1_phone).toBeUndefined()
    expect(two.notes.b1_role).toBe('The kept ASIC extract has no appointment date for this director.')
  })

  it('writes B10 as DD/MM/YYYY (a plain text box) and B24 from the accountant details', () => {
    const p = prefillForm('507b', 'director:1', context())
    expect(value(p, 'b10_date')).toBe('12/06/2014')
    expect(value(p, 'b24_name')).toBe('Alex Ledger, Sample Accounting')
    expect(value(p, 'b24_phone')).toBe('02 0000 0000')
    expect(p.fields.b24_name.source.from).toEqual(['Who prepares the tax returns and BAS.', 'Accountant details on the client file.'])
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
