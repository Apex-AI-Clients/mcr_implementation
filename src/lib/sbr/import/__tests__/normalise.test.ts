// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { cellText, isNoPaymentsEver, nameKey, parseNumber, parseYesNo } from '../normalise'

describe('nameKey', () => {
  it.each([
    ["Wheel'n & Deal'n Pty Ltd", 'wheel n and deal n'],
    ['The Example Co Pty Limited', 'example co'],
    ['EXAMPLE  TRADING PTY. LTD.', 'example trading'],
    ['Example&Sons', 'example and sons'],
    ['Smith & Co (NSW) Pty Ltd', 'smith and co nsw'],
    // Words are only dropped whole: "Theatre", "Ptyx" and "Ltdx" stay.
    ['Theatre Ptyx Ltdx', 'theatre ptyx ltdx'],
    ['  ', ''],
  ])('%s → %s', (name, key) => {
    expect(nameKey(name)).toBe(key)
  })

  it('treats the Pty Ltd / Limited / & spellings of one company as the same', () => {
    expect(nameKey('Example & Partners Pty Ltd')).toBe(nameKey('Example and Partners Pty Limited'))
  })
})

describe('parseNumber', () => {
  it.each([
    ['$142,000.00', 142000],
    [' 25 ', 25],
    ['-', 0],
    [' - ', 0],
    ['0.00', 0],
    ['40.3', 40.3],
    ['-5', -5],
  ])('%s → %s', (cell, n) => {
    expect(parseNumber(cell)).toBe(n)
  })

  it.each(['', 'n/a', '1,2,3a', '0x10', '12abc'])('%s → null', (cell) => {
    expect(parseNumber(cell)).toBeNull()
  })

  it('keeps a numeric cell at full precision', () => {
    expect(parseNumber(317450.6)).toBe(317450.6)
    expect(parseNumber(Number.NaN)).toBeNull()
  })
})

describe('parseYesNo', () => {
  it.each([
    ['Y', true],
    ['yes', true],
    [' YES ', true],
    ['n', false],
    ['No', false],
    ['', null],
    ['Maybe', null],
    ['Yes (Payable)', null],
  ])('%s → %s', (cell, v) => {
    expect(parseYesNo(cell)).toBe(v)
  })
})

describe('isNoPaymentsEver', () => {
  it.each(['NO PAYMENTS EVER', 'NO PAYMENTS EVER.', 'no payment ever', ' No Payments Ever. '])(
    '%s',
    (cell) => expect(isNoPaymentsEver(cell)).toBe(true),
  )
  it.each(['', '0', 'none', 'NO PAYMENTS'])('not %s', (cell) => expect(isNoPaymentsEver(cell)).toBe(false))
})

describe('cellText', () => {
  it('drops the apostrophe our CSV adds before a formula-like cell', () => {
    expect(cellText("'=SUM(A1)")).toBe('=SUM(A1)')
    expect(cellText("O'Brien Pty Ltd")).toBe("O'Brien Pty Ltd")
  })
})
