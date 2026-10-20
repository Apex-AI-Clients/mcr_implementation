import { describe, it, expect } from 'vitest'
import { parsePrintedAmounts, printedAmountsFor } from '../printedNumbers'

/** Reading printed figures and their signs from the text layer. Synthetic lines. */

const parse = (tail: string, columns: number) => parsePrintedAmounts(tail.split(' '), columns)

describe('parsePrintedAmounts', () => {
  it.each([
    // The real two-column P&L rows: "-" is a nil column.
    ['- 1,219', 2, [null, 1219]], // "Superannuation - 1,219"
    ['7,350 -', 2, [7350, null]], // "Training 7,350 -"
    ['2,145 -', 2, [2145, null]], // "Travel - Work Event 2,145 -"
    ['- -', 2, [null, null]], // "Wages - -"
    ['6,815 6,200', 2, [6815, 6200]],
    // Signs attached to a number.
    ['(1,234)', 1, [-1234]],
    ['-1,234', 1, [-1234]],
    ['1,234-', 1, [-1234]],
    ['(500) 700', 2, [-500, 700]],
    // More tokens than columns: a dash must be a sign, and only one reading fits.
    ['5,317 -', 1, [-5317]],
    ['- 127,493', 1, [-127493]],
    ['- 127,493 - 108,437', 2, [-127493, -108437]],
    ['5,317 - 127,493 -', 2, [-5317, -127493]],
    ['1,000 2,000 -', 2, [1000, -2000]],
    ['- 1,000 2,000', 2, [-1000, 2000]],
    // Two readings fit: not read.
    ['5,317 - 7,100', 2, null],
    // Other shapes.
    ['1,234.50', 1, [1234.5]],
    ['$ 2,000', 1, [2000]],
    ['-', 1, [null]],
    ['1,000', 2, null], // too few figures for the columns
  ] as const)('%s over %s column(s) -> %j', (tail, columns, expected) => {
    expect(parse(tail, columns)).toEqual(expected)
  })

  it('refuses text that is not figures', () => {
    expect(parse('see note 4', 1)).toBeNull()
  })
})

describe('printedAmountsFor', () => {
  const page = [
    'SAMPLE HOLDINGS PTY LTD ATF SAMPLE FAMILY TRUST',
    'Profit and Loss Statement',
    'Sales 210,000 190,000',
    'NET TRADING PROFIT /(LOSS) AFTER DEDUCTING LOSS 5,317 - 7,100',
    'Retained Profits - 127,493 - 108,437',
    'Rent 1,200 -',
  ]

  it('reads the real nil-dash rows by their labels', () => {
    const p = ['Superannuation - 1,219', 'Training 7,350 -', 'Travel - Work Event 2,145 -', 'Wages - -']
    expect(printedAmountsFor('Superannuation', p, 2)).toEqual([null, 1219])
    expect(printedAmountsFor('Training', p, 2)).toEqual([7350, null])
    expect(printedAmountsFor('Travel - Work Event', p, 2)).toEqual([2145, null])
    expect(printedAmountsFor('Wages', p, 2)).toEqual([null, null])
  })

  it('finds a line by its label, however it is punctuated', () => {
    expect(printedAmountsFor('Sales', page, 2)).toEqual([210000, 190000])
  })

  it('reads leading minuses on a two-column line', () => {
    expect(printedAmountsFor('Retained Profits', page, 2)).toEqual([-127493, -108437])
  })

  it('declines to guess on ambiguous lines', () => {
    expect(printedAmountsFor('NET TRADING PROFIT/(LOSS) AFTER DEDUCTING LOSS', page, 2)).toBeNull()
  })

  it('reads a trailing "-" in a two-column row as a nil column', () => {
    expect(printedAmountsFor('Rent', page, 2)).toEqual([1200, null])
  })

  it('returns null for a label that is not on the page', () => {
    expect(printedAmountsFor('Wages', page, 2)).toBeNull()
  })
})
