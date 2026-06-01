import type { CurrentPeriodSnapshot } from '@/lib/financials/types'

/** Compact two-line column header. e.g. "to 4 May 2026". */
export function formatCurrentPeriodHeaderDate(cp: CurrentPeriodSnapshot): string {
  const d = new Date(cp.periodEndDate)
  if (Number.isNaN(d.getTime())) return cp.periodEndDate
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Months between periodStartDate and periodEndDate, rounded to the nearest
 *  whole month. Used to surface "covers N months" in the tooltip. */
function monthsBetween(startIso: string, endIso: string): number {
  const start = new Date(startIso)
  const end = new Date(endIso)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0
  const days = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)
  return Math.max(0, Math.round(days / 30.44))
}

export function formatCurrentPeriodTooltip(cp: CurrentPeriodSnapshot): string {
  const months = monthsBetween(cp.periodStartDate, cp.periodEndDate)
  return `Current period covers ${cp.periodLabel} (${months} month${months === 1 ? '' : 's'}). Not directly comparable year-over-year — figures are pre-annualised. Use for trend awareness only.`
}
