import type { CurrentPeriodSnapshot } from '@/lib/financials/types'
import { currentPeriodLabel, currentPeriodName, currentPeriodRange } from '@/lib/financials/periodLabels'

/** Column heading, first line: "FY2027 to date". */
export function formatCurrentPeriodHeaderName(cp: CurrentPeriodSnapshot): string {
  return currentPeriodName(cp)
}

/** Column heading, second line: "1 Jul – 15 Oct 2026". */
export function formatCurrentPeriodHeaderDate(cp: CurrentPeriodSnapshot): string {
  return currentPeriodRange(cp)
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
  return `${currentPeriodLabel(cp)}: ${months} month${months === 1 ? '' : 's'} of the year. Not directly comparable year-over-year — figures are pre-annualised. Use for trend awareness only.`
}
