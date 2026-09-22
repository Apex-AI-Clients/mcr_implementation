import { describe, it, expect } from 'vitest'
import {
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
