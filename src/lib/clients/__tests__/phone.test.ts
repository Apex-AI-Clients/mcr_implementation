import { describe, it, expect } from 'vitest'
import { normaliseClientPhone } from '../phone'

describe('normaliseClientPhone', () => {
  it.each([
    ['0407 552 118', '0407552118'], // the conversion dialog's grouped prefill
    ['+61 407 552 118', '0407552118'],
    ['(07) 4535 9847', '0745359847'],
  ])('stores %s as %s, the same shape as leads.phone', (raw, stored) => {
    expect(normaliseClientPhone(raw)).toBe(stored)
  })

  it.each(['', '   ', null, undefined])('stores %p as null', (raw) => {
    expect(normaliseClientPhone(raw)).toBeNull()
  })

  it('keeps a number it does not recognise rather than dropping it', () => {
    expect(normaliseClientPhone('12345')).toBe('12345')
  })
})
