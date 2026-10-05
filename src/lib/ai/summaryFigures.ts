import type { FinancialsComparison } from '@/lib/financials/types'

/**
 * Checks on the AI summary's figures. Pure.
 *
 * Every dollar figure the summary states must be one of the figures it was
 * given, or the difference between two of them, within 1% (or within the
 * rounding the summary itself used, e.g. "$1.2 million"). A figure that is
 * none of those — like a sum of three years' profits presented as retained
 * earnings — fails the summary.
 */

export interface StatedFigure {
  text: string
  value: number
  /** How far the figure may be from the truth given how it was written. */
  rounding: number
}

const FIGURE = /(-)?\$\s?\(?(\d[\d,]*(?:\.\d+)?)\)?\s*(k|m|bn|b|thousand|million|billion)?\b/gi

const SCALE: Record<string, number> = {
  k: 1e3,
  thousand: 1e3,
  m: 1e6,
  million: 1e6,
  b: 1e9,
  bn: 1e9,
  billion: 1e9,
}

/** Every dollar figure in a text, as a magnitude. */
export function statedFigures(text: string): StatedFigure[] {
  const out: StatedFigure[] = []
  for (const m of text.matchAll(FIGURE)) {
    const digits = m[2].replace(/,/g, '')
    const scale = m[3] ? SCALE[m[3].toLowerCase()] : 1
    const decimals = digits.includes('.') ? digits.split('.')[1].length : 0
    out.push({
      text: m[0].trim(),
      value: Math.abs(parseFloat(digits) * scale),
      rounding: m[3] ? 0.5 * scale * 10 ** -decimals : 0,
    })
  }
  return out
}

/** The dollar figures the summary was given, as magnitudes. */
export function inputFigures(comparison: FinancialsComparison): number[] {
  const values: Array<number | null | undefined> = []
  const h = comparison.headlines
  for (const key of ['revenue', 'netProfit', 'netAssets', 'atoDebtTrajectory', 'directorLoansReceivable'] as const) {
    values.push(...h[key].trend, h[key].latestValue, h[key].currentPeriodValue)
  }
  for (const year of comparison.years) {
    values.push(comparison.atoLiabilityByYear[year]?.total)
    const equity = comparison.equityByYear?.[year]
    values.push(equity?.retainedEarnings, equity?.distributions, equity?.dividends)
  }
  // The sum of profits is deliberately NOT an input: the summary is not given
  // it, so a stated sum of profits fails the check.
  values.push(comparison.currentPeriod?.atoLiabilityTotal)
  return [...new Set(values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v)).map(Math.abs))]
}

/** A stated figure that is an input, or the difference between two inputs. */
function supported(figure: StatedFigure, inputs: number[]): boolean {
  const fits = (truth: number) => Math.abs(figure.value - truth) <= Math.max(0.01 * Math.abs(truth), figure.rounding, 0.5)
  if (figure.value === 0) return true
  if (inputs.some(fits)) return true
  for (let i = 0; i < inputs.length; i++) {
    for (let j = i + 1; j < inputs.length; j++) {
      if (fits(Math.abs(inputs[i] - inputs[j]))) return true
    }
  }
  return false
}

/** The summary's figures that are not in, or directly derived from, its input. */
export function unsupportedFigures(text: string, comparison: FinancialsComparison): string[] {
  const inputs = inputFigures(comparison)
  return statedFigures(text)
    .filter((f) => !supported(f, inputs))
    .map((f) => f.text)
}

/**
 * The summary used when the model's will not check out twice: direction only,
 * no figures, so it cannot state a wrong one.
 */
export function summaryWithoutFigures(comparison: FinancialsComparison): string {
  const h = comparison.headlines
  const first = comparison.years[0]
  const last = comparison.years[comparison.years.length - 1]
  const trendWord = (d: string) => (d === 'up' ? 'rose' : d === 'down' ? 'fell' : 'was broadly flat')
  const profits = h.netProfit.trend.filter((v): v is number => v !== null)
  const profitable = profits.filter((v) => v > 0).length
  const losses = profits.filter((v) => v < 0).length
  const netAssets = h.netAssets.latestValue
  const sentences = [
    `Between FY${first} and FY${last}, revenue ${trendWord(h.revenue.direction)}.`,
    profits.length
      ? `The business recorded ${profitable} profitable year${profitable === 1 ? '' : 's'} and ${losses} loss year${losses === 1 ? '' : 's'}.`
      : null,
    `ATO-related debt ${trendWord(h.atoDebtTrajectory.direction)} over the period.`,
    netAssets !== null
      ? `Net assets were ${netAssets >= 0 ? 'positive' : 'negative'} in the latest year.`
      : null,
    'The automated summary could not be confirmed against the figures, so the figures are in the tables below.',
  ]
  return sentences.filter(Boolean).join(' ')
}
