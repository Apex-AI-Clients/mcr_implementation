import { describe, it, expect } from 'vitest'
import { abnMatchesAcn, isValidAbn, isValidAcn } from '../identifiers'

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
