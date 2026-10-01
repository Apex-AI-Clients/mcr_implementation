import { describe, it, expect } from 'vitest'
import {
  abnMatchesAcn,
  candidateAbnsForAcn,
  formatAbn,
  isValidAbn,
  isValidAcn,
} from '../identifiers'

// Synthetic numbers that pass their check digits (000 000 019 is ASIC's own
// published example). Not any company we deal with.

describe('isValidAcn', () => {
  it('accepts ACNs whose check digit is right, spaced or not', () => {
    expect(isValidAcn('123456780')).toBe(true)
    expect(isValidAcn('123 456 780')).toBe(true)
    expect(isValidAcn('000 000 019')).toBe(true)
  })

  it('rejects a wrong check digit, and the wrong length', () => {
    expect(isValidAcn('123456789')).toBe(false)
    expect(isValidAcn('12345678')).toBe(false)
    expect(isValidAcn('1234567801')).toBe(false)
    expect(isValidAcn('')).toBe(false)
  })
})

describe('isValidAbn', () => {
  it('accepts ABNs that pass the mod-89 check', () => {
    expect(isValidAbn('11123456780')).toBe(true)
    expect(isValidAbn('89 000 000 019')).toBe(true)
  })

  it('rejects one wrong digit, and the wrong length', () => {
    expect(isValidAbn('11123456781')).toBe(false)
    expect(isValidAbn('12123456780')).toBe(false)
    expect(isValidAbn('1112345678')).toBe(false)
  })
})

describe('abnMatchesAcn', () => {
  it("is true when the ABN's last nine digits are the ACN", () => {
    expect(abnMatchesAcn('11 123 456 780', '123 456 780')).toBe(true)
  })

  it('is false for another company', () => {
    expect(abnMatchesAcn('89000000019', '123456780')).toBe(false)
  })
})

describe('candidateAbnsForAcn', () => {
  it('gives the one ABN a company with this ACN would have', () => {
    expect(candidateAbnsForAcn('123 456 780')).toEqual(['11123456780'])
  })

  it('gives both when the checksum allows 10 and 99', () => {
    expect(candidateAbnsForAcn('100000682')).toEqual(['10100000682', '99100000682'])
  })

  it('every candidate passes the ABN check and ends with the ACN', () => {
    for (const abn of candidateAbnsForAcn('000000019')) {
      expect(isValidAbn(abn)).toBe(true)
      expect(abnMatchesAcn(abn, '000000019')).toBe(true)
    }
  })

  it('gives nothing for an ACN that fails its own check, or is not 9 digits', () => {
    expect(candidateAbnsForAcn('123456789')).toEqual([])
    expect(candidateAbnsForAcn('1234')).toEqual([])
    expect(candidateAbnsForAcn('')).toEqual([])
  })
})

describe('formatAbn', () => {
  it('groups 2-3-3-3 the way the ATO prints it', () => {
    expect(formatAbn('11123456780')).toBe('11 123 456 780')
    expect(formatAbn('11 123456780')).toBe('11 123 456 780')
  })

  it('leaves anything that is not 11 digits as given', () => {
    expect(formatAbn('123')).toBe('123')
  })
})
