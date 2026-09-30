import { describe, it, expect } from 'vitest'
import {
  acnDiffers,
  applyExtract,
  describeDirector,
  directorRowErrors,
  directorsForSave,
  formatAcn,
  resolveOrigin,
  sourceFor,
  sourceLabel,
  type AsicFields,
} from '../fill'
import type { AsicExtract } from '../types'

/** Synthetic. Nobody real. */
const EXTRACT: AsicExtract = {
  companyName: 'Sample Trading Pty Ltd',
  acn: '123456780',
  abn: '11123456780',
  status: 'Registered',
  registeredOffice: 'Unit 1, 10 Sample Road, North Melbourne VIC 3051',
  principalPlaceOfBusiness: 'Level 2, 20 Example Street, Sampleton NSW 2000',
  directors: [
    { name: 'Jane Sample', dateOfBirth: '1970-03-14' },
    { name: 'Raj Example', dateOfBirth: null },
  ],
  extractType: 'current',
  extractedAt: '2026-09-23T14:07:38+10:00',
  warnings: ['One director has no date of birth in this extract.'],
}

const EMPTY: AsicFields = { registeredOfficeAddress: '', principalPlaceOfBusiness: '', directors: [] }

describe('applyExtract', () => {
  it('fills the two addresses and the directors, with dates as they are typed', () => {
    const fill = applyExtract(EMPTY, EXTRACT)
    expect(fill.filled).toEqual({
      registeredOfficeAddress: 'Unit 1, 10 Sample Road, North Melbourne VIC 3051',
      principalPlaceOfBusiness: 'Level 2, 20 Example Street, Sampleton NSW 2000',
      directors: [
        { name: 'Jane Sample', dateOfBirth: '14/03/1970' },
        { name: 'Raj Example', dateOfBirth: '' },
      ],
    })
    expect(fill.extractedAt).toBe('2026-09-23T14:07:38+10:00')
    expect(fill.warnings).toEqual(EXTRACT.warnings)
  })

  it('has no company name, ACN or ABN in what it fills', () => {
    const fill = applyExtract(EMPTY, EXTRACT)
    const text = JSON.stringify(fill.filled)
    expect(Object.keys(fill.filled).sort()).toEqual([
      'directors',
      'principalPlaceOfBusiness',
      'registeredOfficeAddress',
    ])
    expect(text).not.toContain('Sample Trading')
    expect(text).not.toContain('123456780')
    expect(text).not.toContain('11123456780')
  })

  it('keeps what was there before, for undo', () => {
    const typed: AsicFields = {
      registeredOfficeAddress: '1 Typed Street',
      principalPlaceOfBusiness: '',
      directors: [{ name: 'Typed Person', dateOfBirth: '1960' }],
    }
    expect(applyExtract(typed, EXTRACT).previous).toEqual(typed)
  })

  it('leaves a typed value alone when the extract has nothing for it', () => {
    const typed: AsicFields = {
      registeredOfficeAddress: '1 Typed Street',
      principalPlaceOfBusiness: '2 Typed Avenue',
      directors: [{ name: 'Typed Person', dateOfBirth: '' }],
    }
    const fill = applyExtract(typed, {
      ...EXTRACT,
      registeredOffice: null,
      principalPlaceOfBusiness: null,
      directors: [],
    })
    expect(fill.filled).toEqual(typed)
  })
})

describe('acnDiffers', () => {
  it('is true only when the form has a whole, different ACN', () => {
    expect(acnDiffers('000 000 019', '123456780')).toBe(true)
    expect(acnDiffers('123 456 780', '123456780')).toBe(false)
  })

  it('is false for an empty or half-typed ACN — nothing to contradict', () => {
    expect(acnDiffers('', '123456780')).toBe(false)
    expect(acnDiffers('1234', '123456780')).toBe(false)
  })
})

describe('formatAcn', () => {
  it('groups nine digits in threes', () => {
    expect(formatAcn('123456780')).toBe('123 456 780')
  })
})

describe('directorRowErrors', () => {
  it('accepts blank rows, names alone, and every date precision', () => {
    expect(
      directorRowErrors([
        { name: '', dateOfBirth: '' },
        { name: 'Jane Sample', dateOfBirth: '' },
        { name: 'Jane Sample', dateOfBirth: '14/03/1970' },
        { name: 'Jane Sample', dateOfBirth: '03/1970' },
        { name: 'Jane Sample', dateOfBirth: '1970' },
      ]),
    ).toEqual([null, null, null, null, null])
  })

  it('asks for a name when only a date was typed', () => {
    expect(directorRowErrors([{ name: ' ', dateOfBirth: '1970' }])).toEqual([
      "Enter the director's name.",
    ])
  })

  it('says how to write a date it cannot read', () => {
    expect(directorRowErrors([{ name: 'Jane Sample', dateOfBirth: '14 March 1970' }])).toEqual([
      'Use DD/MM/YYYY, MM/YYYY or YYYY.',
    ])
  })
})

describe('directorsForSave', () => {
  it('drops blank rows, trims names and stores dates as ISO', () => {
    expect(
      directorsForSave([
        { name: '  Jane Sample ', dateOfBirth: '14/03/1970' },
        { name: '', dateOfBirth: '' },
        { name: 'Raj Example', dateOfBirth: '' },
        { name: 'Mei Sample', dateOfBirth: '1988' },
      ]),
    ).toEqual([
      { name: 'Jane Sample', dateOfBirth: '1970-03-14' },
      { name: 'Raj Example', dateOfBirth: null },
      { name: 'Mei Sample', dateOfBirth: '1988' },
    ])
  })
})

describe('sourceFor', () => {
  const fill = applyExtract(EMPTY, EXTRACT)

  it("is 'asic_pdf' when saved exactly as filled", () => {
    expect(sourceFor(fill, fill.filled)).toBe('asic_pdf')
  })

  it('ignores whitespace and a trailing blank director row', () => {
    expect(
      sourceFor(fill, {
        ...fill.filled,
        registeredOfficeAddress: `${fill.filled.registeredOfficeAddress}  `,
        directors: [...fill.filled.directors, { name: '', dateOfBirth: '' }],
      }),
    ).toBe('asic_pdf')
  })

  it("is 'asic_pdf_edited' when either address changed", () => {
    expect(sourceFor(fill, { ...fill.filled, registeredOfficeAddress: '1 Other Street' })).toBe(
      'asic_pdf_edited',
    )
    expect(sourceFor(fill, { ...fill.filled, principalPlaceOfBusiness: '' })).toBe('asic_pdf_edited')
  })

  it("is 'asic_pdf_edited' when a director was changed, added or removed", () => {
    const [jane, raj] = fill.filled.directors
    expect(sourceFor(fill, { ...fill.filled, directors: [jane, { ...raj, dateOfBirth: '1981' }] })).toBe(
      'asic_pdf_edited',
    )
    expect(sourceFor(fill, { ...fill.filled, directors: [jane] })).toBe('asic_pdf_edited')
    expect(
      sourceFor(fill, { ...fill.filled, directors: [jane, raj, { name: 'New Person', dateOfBirth: '' }] }),
    ).toBe('asic_pdf_edited')
  })

  it("is 'manual' with no extract and something typed", () => {
    expect(sourceFor(null, { ...EMPTY, registeredOfficeAddress: '1 Typed Street' })).toBe('manual')
    expect(sourceFor(null, { ...EMPTY, directors: [{ name: 'Typed Person', dateOfBirth: '' }] })).toBe(
      'manual',
    )
  })

  it('is null with no extract and nothing typed', () => {
    expect(sourceFor(null, EMPTY)).toBeNull()
    expect(sourceFor(null, { ...EMPTY, directors: [{ name: '', dateOfBirth: '' }] })).toBeNull()
  })
})

describe('sourceLabel', () => {
  it('says where the fields came from, and whether they were edited', () => {
    expect(sourceLabel('asic_pdf', '23 September 2026')).toBe(
      'From ASIC extract as at 23 September 2026',
    )
    expect(sourceLabel('asic_pdf_edited', '23 September 2026')).toBe(
      'From ASIC extract as at 23 September 2026, edited',
    )
    expect(sourceLabel('manual', '')).toBeNull()
    expect(sourceLabel(null, '')).toBeNull()
  })
})

describe('resolveOrigin — editing a record that is already saved', () => {
  const fill = applyExtract(EMPTY, EXTRACT)
  const fields = fill.filled
  const DATE = '2026-09-23T14:07:38+10:00'
  const saved = (source: string | null) => ({ source, extractedAt: source ? DATE : null, fields })

  it('keeps an untouched extract record as it was', () => {
    expect(resolveOrigin(null, saved('asic_pdf'), fields)).toEqual({
      source: 'asic_pdf',
      extractedAt: DATE,
    })
  })

  it('turns it to edited, keeping the date, when a filled field is changed later', () => {
    const changed = { ...fields, principalPlaceOfBusiness: '9 New Street' }
    expect(resolveOrigin(null, saved('asic_pdf'), changed)).toEqual({
      source: 'asic_pdf_edited',
      extractedAt: DATE,
    })
  })

  it('never turns an edited record back into an unedited one', () => {
    expect(resolveOrigin(null, saved('asic_pdf_edited'), fields).source).toBe('asic_pdf_edited')
  })

  it('lets a new upload in this sitting decide, with its own date', () => {
    const newer = applyExtract(fields, { ...EXTRACT, extractedAt: '2027-01-05T09:15:00+11:00' })
    expect(resolveOrigin(newer, saved('asic_pdf_edited'), newer.filled)).toEqual({
      source: 'asic_pdf',
      extractedAt: '2027-01-05T09:15:00+11:00',
    })
  })

  it('has no source or date once everything from the extract has been cleared', () => {
    expect(resolveOrigin(null, saved('asic_pdf'), EMPTY)).toEqual({ source: null, extractedAt: null })
  })

  it("is 'manual' for a record typed by hand, and for a new one", () => {
    expect(resolveOrigin(null, saved('manual'), fields)).toEqual({ source: 'manual', extractedAt: null })
    expect(resolveOrigin(null, null, fields)).toEqual({ source: 'manual', extractedAt: null })
    expect(resolveOrigin(null, null, EMPTY)).toEqual({ source: null, extractedAt: null })
  })
})

describe('describeDirector', () => {
  it('shows the date of birth at whatever precision is stored, or just the name', () => {
    expect(describeDirector({ name: 'Jane Sample', dateOfBirth: '1970-03-14' })).toBe(
      'Jane Sample · born 14/03/1970',
    )
    expect(describeDirector({ name: 'Jane Sample', dateOfBirth: '1970' })).toBe(
      'Jane Sample · born 1970',
    )
    expect(describeDirector({ name: 'Jane Sample', dateOfBirth: null })).toBe('Jane Sample')
  })
})
