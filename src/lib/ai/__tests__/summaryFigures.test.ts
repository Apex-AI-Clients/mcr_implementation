import { describe, it, expect } from 'vitest'
import { promptFigures, statedFigures, unsupportedFigures } from '../summaryFigures'

/**
 * The AI summary's figure check. SYNTHETIC figures shaped like the trust
 * client: three years' profits whose sum is NOT a figure given.
 */

// Profits 52,100 + 48,300 + 55,800 = 156,200: the figure that must never appear.
const INPUTS = [800_000, 850_000, 900_000, 52_100, 48_300, 55_800, 108_437, 15_284, 0]

describe('statedFigures', () => {
  it('reads plain, abbreviated and negative figures', () => {
    expect(statedFigures('over $156,000, a loss of -$5,317, $1.2 million and $52k').map((f) => f.value)).toEqual([
      156_000, 5_317, 1_200_000, 52_000,
    ])
  })
})

describe('promptFigures', () => {
  it('takes every dollar figure in the prompt once, as a magnitude', () => {
    expect(promptFigures('Revenue: $800,000; Net profit: -$52,100; again $800,000. 6 lodgements late.')).toEqual([800_000, 52_100])
  })
})

describe('unsupportedFigures', () => {
  it('accepts input figures, differences of two, and rounding', () => {
    const text =
      'Revenue grew from $800,000 to $900,000, up $100,000. The loan moved from -$108,437 to $0 after a $15,284 repayment. Net profit was about $56k.'
    expect(unsupportedFigures(text, INPUTS)).toEqual([])
  })

  it('rejects a sum of profits, and a made-up figure', () => {
    expect(unsupportedFigures('accumulating over $156,000 in profits', INPUTS)).toEqual(['$156,000'])
    expect(unsupportedFigures('a balance of $123,456', INPUTS)).toEqual(['$123,456'])
  })
})
