import { describe, it, expect } from 'vitest'
import { classifyAbnForBackfill } from '../identityBackfill'

// Synthetic numbers that pass their check digits. ACN 123 456 780; the
// company's own ABN is 11 + that ACN. 51 824 753 556 is the ATO's published
// example ABN and stands in for a trust's. Not any entity we deal with.
const ACN = '123456780'
const COMPANY_ABN = '11123456780'
const TRUST_ABN = '51824753556'

describe('classifyAbnForBackfill', () => {
  it('keeps an ABN that ends with the ACN — it is the company’s own', () => {
    expect(
      classifyAbnForBackfill({ acnNumber: ACN, abnNumber: COMPANY_ABN, trustName: 'Sample Family Trust' }),
    ).toBe('keep')
  })

  it('compares digits only, whatever the spacing', () => {
    expect(
      classifyAbnForBackfill({
        acnNumber: '123 456 780',
        abnNumber: '11 123 456 780',
        trustName: 'Sample Family Trust',
      }),
    ).toBe('keep')
  })

  it('moves an ABN that does not end with the ACN to the trust', () => {
    expect(
      classifyAbnForBackfill({ acnNumber: ACN, abnNumber: TRUST_ABN, trustName: 'Sample Family Trust' }),
    ).toBe('move_to_trust')
  })

  it('moves the ABN to the trust when there is no ACN to compare with', () => {
    expect(
      classifyAbnForBackfill({ acnNumber: null, abnNumber: TRUST_ABN, trustName: 'Sample Family Trust' }),
    ).toBe('move_to_trust')
    expect(
      classifyAbnForBackfill({ acnNumber: '  ', abnNumber: TRUST_ABN, trustName: 'Sample Family Trust' }),
    ).toBe('move_to_trust')
  })

  it('never moves anything on a record with no trust name', () => {
    expect(classifyAbnForBackfill({ acnNumber: ACN, abnNumber: TRUST_ABN, trustName: null })).toBe('skip')
    expect(classifyAbnForBackfill({ acnNumber: ACN, abnNumber: TRUST_ABN, trustName: ' ' })).toBe('skip')
  })

  it('has nothing to decide without an ABN', () => {
    expect(
      classifyAbnForBackfill({ acnNumber: ACN, abnNumber: null, trustName: 'Sample Family Trust' }),
    ).toBe('skip')
    expect(
      classifyAbnForBackfill({ acnNumber: ACN, abnNumber: '', trustName: 'Sample Family Trust' }),
    ).toBe('skip')
  })
})
