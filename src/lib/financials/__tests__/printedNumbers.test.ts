import { describe, it, expect } from 'vitest'
import { parsePrintedAmounts, printedAmountsFor } from '../printedNumbers'

/** Reading printed figures and their signs from the text layer. Synthetic lines. */

const parse = (tail: string, columns: number) => parsePrintedAmounts(tail.split(' '), columns)

describe('parsePrintedAmounts', () => {
  it.each([
    ['4,682 -', 1, [-4682]],
    ['- 139,668', 1, [-139668]],
    ['(1,234)', 1, [-1234]],
    ['-1,234', 1, [-1234]],
    ['1,234-', 1, [-1234]],
    ['1,234.50', 1, [1234.5]],
    ['$ 2,000', 1, [2000]],
    ['-', 1, [null]],
    ['4,682 - 139,668 -', 2, [-4682, -139668]], // trailing convention, shown by the end dash
    ['- 4,682 - 139,668', 2, [-4682, -139668]], // leading convention, shown by the start dash
    ['4,682 - 139,668', 2, null], // a dash between two numbers, no convention shown: unreadable
    ['1,000 2,000 -', 2, [1000, -2000]],
    ['- 1,000 2,000', 2, [-1000, 2000]],
    ['(500) 700', 2, [-500, 700]],
    ['1,000 -', 2, null], // one number, two columns: the dash may be a nil column
    ['- -', 2, [null, null]],
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
    'NET TRADING PROFIT /(LOSS) AFTER DEDUCTING LOSS 4,682 - 7,100',
    'Retained Profits - 139,668 - 116,215',
    'Rent 1,200 -',
  ]

  it('finds a line by its label, however it is punctuated', () => {
    expect(printedAmountsFor('Sales', page, 2)).toEqual([210000, 190000])
  })

  it('reads leading minuses on a two-column line', () => {
    expect(printedAmountsFor('Retained Profits', page, 2)).toEqual([-139668, -116215])
  })

  it('declines to guess on ambiguous lines', () => {
    expect(printedAmountsFor('NET TRADING PROFIT/(LOSS) AFTER DEDUCTING LOSS', page, 2)).toBeNull()
    expect(printedAmountsFor('Rent', page, 2)).toBeNull()
  })

  it('returns null for a label that is not on the page', () => {
    expect(printedAmountsFor('Wages', page, 2)).toBeNull()
  })
})
