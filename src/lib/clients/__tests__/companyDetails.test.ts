import { describe, it, expect } from 'vitest'
import {
  CompanyDetailsSchema,
  companyDetailsInsert,
  companyDetailsUpdate,
  hasCompanyDetails,
} from '../companyDetails'

/**
 * Absent and empty are different things on this record, and this is the file
 * that keeps them different.
 *
 * Two forms write company_details. The intake company step renders all six
 * fields and sends all six, so clearing a box has to clear the column. Intake
 * step 1 sends only what the business register answered — a name, an ABN,
 * sometimes an ACN — and must not touch the phone number and email it knows
 * nothing about. No register carries those, so a partial write that treated
 * absent as empty would quietly wipe the client's contact details every time
 * somebody corrected a company name.
 */

describe('companyDetailsUpdate', () => {
  it('sets only the columns that were supplied', () => {
    expect(companyDetailsUpdate({ companyName: 'Whitlock Civil Pty Ltd' })).toEqual({
      company_name: 'Whitlock Civil Pty Ltd',
    })
  })

  it('leaves the phone and email alone on a register-only write', () => {
    // The exact shape intake step 1 sends after a lookup.
    const update = companyDetailsUpdate({
      companyName: 'Whitlock Civil Pty Ltd',
      abnNumber: '53004085616',
      acnNumber: '004085616',
    })

    expect(update).not.toHaveProperty('phone_number')
    expect(update).not.toHaveProperty('email_address')
    expect(update).not.toHaveProperty('trust_name')
  })

  it('does clear a column somebody deliberately emptied', () => {
    // '' is a value, not an absence — the company step sends it for a box that
    // was cleared, and that has to reach the column.
    expect(companyDetailsUpdate({ trustName: '' })).toEqual({ trust_name: '' })
  })

  it('maps every field to its column', () => {
    expect(
      companyDetailsUpdate({
        companyName: 'a',
        acnNumber: 'b',
        abnNumber: 'c',
        trustName: 'd',
        phoneNumber: 'e',
        emailAddress: 'f',
      }),
    ).toEqual({
      company_name: 'a',
      acn_number: 'b',
      abn_number: 'c',
      trust_name: 'd',
      phone_number: 'e',
      email_address: 'f',
    })
  })

  it('ignores anything that is not a string', () => {
    const update = companyDetailsUpdate({
      companyName: undefined,
      acnNumber: null as unknown as string,
      abnNumber: 53004085616 as unknown as string,
    })
    expect(update).toEqual({})
  })

  it('never carries a key the caller did not send', () => {
    expect(Object.keys(companyDetailsUpdate({}))).toEqual([])
  })
})

describe('companyDetailsInsert', () => {
  it('writes every column, with nothing supplied stored as null', () => {
    // A new row has no existing value to preserve, so leaving columns out would
    // make the database defaults the real definition of a blank field.
    expect(companyDetailsInsert('cl_1', { companyName: 'Whitlock Civil Pty Ltd' })).toEqual({
      client_id: 'cl_1',
      company_name: 'Whitlock Civil Pty Ltd',
      acn_number: null,
      abn_number: null,
      trust_name: null,
      phone_number: null,
      email_address: null,
      registered_office_address: null,
      principal_place_of_business: null,
      directors: [],
      asic_extract_date: null,
      company_details_source: null,
    })
  })

  it('keeps an empty string as an empty string, not a null', () => {
    expect(companyDetailsInsert('cl_1', { trustName: '' }).trust_name).toBe('')
  })
})

describe('hasCompanyDetails', () => {
  it('is false when there is nothing to write', () => {
    expect(hasCompanyDetails({})).toBe(false)
    expect(hasCompanyDetails({ companyName: undefined })).toBe(false)
  })

  it('is true for a single cleared field', () => {
    expect(hasCompanyDetails({ trustName: '' })).toBe(true)
  })

  it('is true for a register-only write', () => {
    expect(hasCompanyDetails({ abnNumber: '53004085616' })).toBe(true)
  })
})

/**
 * The ASIC fields (migration 0022). The same rule, and one new way to get it
 * wrong: a directors array that is absent is not a directors array that is
 * empty. Synthetic people only.
 */
describe('the ASIC fields — absent is not empty', () => {
  const JANE = { name: 'Jane Sample', dateOfBirth: '1970-03-14' }

  it('leaves directors, addresses, the extract date and the source alone on a register-only write', () => {
    // The exact shape intake step 1 sends after a lookup.
    const update = companyDetailsUpdate({
      companyName: 'Sample Trading Pty Ltd',
      abnNumber: '11123456780',
      acnNumber: '123456780',
    })

    expect(update).not.toHaveProperty('directors')
    expect(update).not.toHaveProperty('registered_office_address')
    expect(update).not.toHaveProperty('principal_place_of_business')
    expect(update).not.toHaveProperty('asic_extract_date')
    expect(update).not.toHaveProperty('company_details_source')
  })

  it('removes every director only when an empty array is actually sent', () => {
    expect(companyDetailsUpdate({ directors: [] })).toEqual({ directors: [] })
    expect(companyDetailsUpdate({})).toEqual({})
    expect(companyDetailsUpdate({ directors: undefined })).toEqual({})
  })

  it('writes the directors, addresses, date and source when they are sent', () => {
    expect(
      companyDetailsUpdate({
        registeredOfficeAddress: '1 Sample Road',
        principalPlaceOfBusiness: '',
        directors: [JANE, { name: 'Raj Example', dateOfBirth: null }],
        asicExtractDate: '2026-09-23T14:07:38+10:00',
        companyDetailsSource: 'asic_pdf',
      }),
    ).toEqual({
      registered_office_address: '1 Sample Road',
      principal_place_of_business: '',
      directors: [JANE, { name: 'Raj Example', dateOfBirth: null }],
      asic_extract_date: '2026-09-23T14:07:38+10:00',
      company_details_source: 'asic_pdf',
    })
  })

  it('clears the extract date and source with null, and leaves them with undefined', () => {
    expect(companyDetailsUpdate({ asicExtractDate: null, companyDetailsSource: null })).toEqual({
      asic_extract_date: null,
      company_details_source: null,
    })
  })

  it('stores nothing about a director beyond the name and date of birth', () => {
    const wide = { ...JANE, placeOfBirth: 'BIRTHVILLE', address: '42 Private Lane' }
    expect(companyDetailsUpdate({ directors: [wide] }).directors).toEqual([JANE])
    expect(companyDetailsInsert('cl_1', { directors: [wide] }).directors).toEqual([JANE])
  })

  it('counts a directors array, even an empty one, as something to write', () => {
    expect(hasCompanyDetails({ directors: [] })).toBe(true)
    expect(hasCompanyDetails({ companyDetailsSource: null })).toBe(true)
    expect(hasCompanyDetails({ directors: undefined })).toBe(false)
  })
})

describe('CompanyDetailsSchema', () => {
  const parse = (value: unknown) => CompanyDetailsSchema.safeParse(value)

  it('accepts every date-of-birth precision, and none', () => {
    const result = parse({
      directors: [
        { name: 'Jane Sample', dateOfBirth: '1970-03-14' },
        { name: 'Raj Example', dateOfBirth: '1981-11' },
        { name: 'Mei Sample', dateOfBirth: '1988' },
        { name: 'No Date', dateOfBirth: null },
      ],
    })
    expect(result.success).toBe(true)
  })

  it('keeps absent fields absent, so a partial save stays partial', () => {
    const result = parse({ companyName: 'Sample Trading Pty Ltd' })
    expect(result.success && result.data).toEqual({ companyName: 'Sample Trading Pty Ltd' })
  })

  it('drops anything it does not know, including extra director fields', () => {
    const result = parse({
      shareholders: [{ name: 'Holly Shareholder' }],
      directors: [{ name: 'Jane Sample', dateOfBirth: null, placeOfBirth: 'BIRTHVILLE' }],
    })
    expect(result.success && result.data).toEqual({
      directors: [{ name: 'Jane Sample', dateOfBirth: null }],
    })
  })

  it.each([
    ['a date in the form staff type', { directors: [{ name: 'Jane Sample', dateOfBirth: '14/03/1970' }] }],
    ['a date that does not exist', { directors: [{ name: 'Jane Sample', dateOfBirth: '1970-02-30' }] }],
    ['a director with no name', { directors: [{ name: '  ', dateOfBirth: null }] }],
    ['directors that are not an array', { directors: 'Jane Sample' }],
    ['more directors than any company has', { directors: Array(21).fill({ name: 'Jane Sample', dateOfBirth: null }) }],
    ['a source outside the three', { companyDetailsSource: 'asic_api' }],
    ['an extract date that is not a timestamp', { asicExtractDate: '23 September 2026' }],
  ])('rejects %s', (_, value) => {
    expect(parse(value).success).toBe(false)
  })
})
