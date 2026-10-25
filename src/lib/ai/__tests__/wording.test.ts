import { describe, expect, it } from 'vitest'
import { BANNED_WORDS, bannedWordsIn, withoutBannedSentences } from '../wording'

/** One banned-word list for every summary. */

describe('banned words', () => {
  it.each(['solvency', 'Solvency', 'solvent', 'insolvent', 'insolvency', 'fraudulent', 'illegal', 'breached', 'phoenixing'])('catches "%s"', (word) => {
    expect(BANNED_WORDS.test(`The figures suggest ${word} here.`)).toBe(true)
  })

  it('leaves ordinary words alone', () => {
    expect(bannedWordsIn('Revenue rose while ATO debt grew; liabilities exceeded assets.')).toEqual([])
  })

  it('lists each word once, lower case', () => {
    expect(bannedWordsIn('Solvency, solvency and an insolvent company.')).toEqual(['solvency', 'insolvent'])
  })

  it('removes only the sentences that use one', () => {
    expect(withoutBannedSentences('Revenue fell. This implies ongoing solvency concerns. Debt rose!')).toBe('Revenue fell. Debt rose!')
  })
})
