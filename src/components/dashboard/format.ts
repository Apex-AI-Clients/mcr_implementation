/** Number formatting for the home dashboard. */

const whole = new Intl.NumberFormat('en-AU', { maximumFractionDigits: 0 })

export function formatCount(n: number): string {
  return whole.format(n)
}

/** $31.2m, $840k, $9,200 — short enough for a tile. Negative: a credit. */
export function formatMoneyShort(n: number): string {
  const sign = n < 0 ? '−' : ''
  const a = Math.abs(n)
  if (a >= 1_000_000) return `${sign}$${(a / 1_000_000).toFixed(a >= 10_000_000 ? 1 : 2).replace(/\.?0+$/, '')}m`
  if (a >= 10_000) return `${sign}$${Math.round(a / 1_000)}k`
  return `${sign}$${whole.format(Math.round(a))}`
}

/** "+12%", "−5%", or null when there is nothing to compare with. */
export function formatChange(pct: number | null): string | null {
  if (pct === null) return null
  if (pct === 0) return 'No change'
  return `${pct > 0 ? '+' : '−'}${Math.abs(pct)}%`
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${formatCount(n)} ${n === 1 ? one : many}`
}
