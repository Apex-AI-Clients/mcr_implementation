import { describe, it, expect } from 'vitest'
import { formatAcn, isValidAbn, isValidAcn } from '../identifiers'
import { formatFee } from '../fee'

describe('isValidAcn', () => {
  it('accepts ACNs whose check digit is right, however spaced', () => {
    // 004 085 616 is asicapi's own documented example.
    for (const acn of ['004085616', '004 085 616', '000000019', '000000028']) {
      expect(isValidAcn(acn)).toBe(true)
    }
  })

  it('refuses a wrong check digit or a wrong length', () => {
    for (const acn of ['004085617', '000000018', '12345678', '1234567890', '', 'abcdefghi']) {
      expect(isValidAcn(acn)).toBe(false)
    }
  })
})

describe('isValidAbn', () => {
  it('accepts ABNs whose check digits are right', () => {
    for (const abn of ['53004085616', '53 004 085 616', '89000000019', '91000000028']) {
      expect(isValidAbn(abn)).toBe(true)
    }
  })

  it('refuses a wrong check or a wrong length', () => {
    for (const abn of ['53004085617', '1234567890', '', '89000000018']) {
      expect(isValidAbn(abn)).toBe(false)
    }
  })
})

describe('formatAcn', () => {
  it('groups nine digits the way ASIC prints them', () => {
    expect(formatAcn('000000019')).toBe('000 000 019')
    expect(formatAcn('000 000019')).toBe('000 000 019')
  })

  it('leaves anything else alone', () => {
    expect(formatAcn('1234')).toBe('1234')
  })
})

describe('formatFee', () => {
  it('always shows cents on a price', () => {
    expect(formatFee(1000)).toBe('$10.00')
    expect(formatFee(1050)).toBe('$10.50')
    expect(formatFee(0)).toBe('$0.00')
  })
})
