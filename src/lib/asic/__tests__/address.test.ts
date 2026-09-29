import { describe, it, expect } from 'vitest'
import { formatAsicAddress } from '../address'

describe('formatAsicAddress', () => {
  it('tidies ASIC capitals and keeps state codes upper', () => {
    expect(
      formatAsicAddress({
        street: '12 EXAMPLE STREET',
        locality: 'NORTH MELBOURNE',
        state: 'VIC',
        postcode: '3051',
        country: 'AUSTRALIA',
      }),
    ).toBe('12 Example Street, North Melbourne VIC 3051')
  })

  it('puts care-of and the first line ahead of the street', () => {
    expect(
      formatAsicAddress({
        careOf: 'C/- EXAMPLE ACCOUNTANTS',
        line1: 'LEVEL 3',
        street: '12 EXAMPLE STREET',
        locality: 'MELBOURNE',
        state: 'VIC',
        postcode: '3000',
      }),
    ).toBe('C/- Example Accountants, Level 3, 12 Example Street, Melbourne VIC 3000')
  })

  it('keeps a country other than Australia', () => {
    expect(
      formatAsicAddress({ street: '1 SAMPLE ROAD', locality: 'AUCKLAND', country: 'NEW ZEALAND' }),
    ).toBe('1 Sample Road, Auckland, New Zealand')
  })

  it('works from whatever parts are present', () => {
    expect(formatAsicAddress({ locality: 'SAMPLEVILLE', state: 'NSW' })).toBe('Sampleville NSW')
    expect(formatAsicAddress({ street: '5 PLACEHOLDER LANE', postcode: '2000' })).toBe(
      '5 Placeholder Lane, 2000',
    )
  })

  it('answers null when there is nothing usable', () => {
    expect(formatAsicAddress(null)).toBeNull()
    expect(formatAsicAddress(undefined)).toBeNull()
    expect(formatAsicAddress({})).toBeNull()
    expect(formatAsicAddress({ street: '  ', locality: null, country: 'AUSTRALIA' })).toBeNull()
  })

  it('leaves text that is already mixed case alone', () => {
    expect(formatAsicAddress({ street: '1 McKenzie Street', locality: 'Kew', state: 'VIC' })).toBe(
      '1 McKenzie Street, Kew VIC',
    )
  })
})
