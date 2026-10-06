/**
 * How a year-on-year change reads when either value is negative. A percentage
 * of a negative base misleads ("+108%" for a loss that grew), so the change is
 * shown in dollars with words instead: "Loss up $33,684", "Loss down $34,646",
 * "Into loss, down $12,000". Pure.
 *
 * Returns null when both values are zero or above — the percentage is fine there.
 */

export interface SignedChange {
  text: string
  /** Which way the figure moved. */
  direction: 'up' | 'down' | 'flat'
  /** Better or worse, given whether a higher figure is good. */
  improved: boolean | null
}

const money = (n: number) => `$${Math.round(Math.abs(n)).toLocaleString('en-AU')}`

/** The noun a negative value of this line is called, or null for none. */
export function negativeNoun(key: string): string | null {
  if (/^(netProfit|profitBeforeTax|netProfitAfterTax|grossProfit)$/.test(key)) return 'Loss'
  if (/^(netAssets|totalEquity|retainedEarnings)$/.test(key)) return 'Deficit'
  return null
}

export function signedChange(
  previous: number | null | undefined,
  current: number | null | undefined,
  { noun = null, higherIsBetter = true }: { noun?: string | null; higherIsBetter?: boolean } = {},
): SignedChange | null {
  if (typeof previous !== 'number' || typeof current !== 'number') return null
  if (previous >= 0 && current >= 0) return null

  const diff = current - previous
  if (Math.abs(diff) < 0.5) return { text: 'No change', direction: 'flat', improved: null }
  const direction = diff > 0 ? 'up' : 'down'
  const improved = higherIsBetter ? diff > 0 : diff < 0
  const amount = money(diff)

  if (!noun) return { text: `${diff > 0 ? 'Up' : 'Down'} ${amount}`, direction, improved }
  const lower = noun.toLowerCase()
  if (previous < 0 && current < 0) {
    // A more negative figure is a bigger loss / deficit.
    return { text: `${noun} ${diff < 0 ? 'up' : 'down'} ${amount}`, direction, improved }
  }
  if (previous >= 0) return { text: `Into ${lower}, down ${amount}`, direction, improved }
  return { text: `Out of ${lower}, up ${amount}`, direction, improved }
}
