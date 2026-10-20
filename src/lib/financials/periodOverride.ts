import type { FinancialsPrepass } from './prepass'
import type { ExtractionWarning } from './types'

/**
 * Staff correcting what a file's headings say: annual for FY X, or a current
 * period within FY X (documents.fs_override_*, migration 0031). Pure.
 *
 * Applied to the pre-pass before extraction, in place of the years the
 * headings named. Everything after that — the guidance the model is given,
 * the correction of what it returns, the expected columns — then follows the
 * override exactly as it would have followed the headings.
 *
 * It changes the year and the role only, never what the file is: a file the
 * pre-pass reads as a trust deed or a bare tax return is still not
 * extracted, because tax return figures must never be stored as statements.
 */

export type PeriodKind = 'annual' | 'current_period'

export interface PeriodOverride {
  kind: PeriodKind
  financialYear: number
}

/** The override stored on a document row, or null when there is none (or it is incomplete). */
export function periodOverrideOf(row: {
  fs_override_kind?: string | null
  fs_override_fy?: number | null
}): PeriodOverride | null {
  const kind = row.fs_override_kind
  const year = row.fs_override_fy
  if ((kind !== 'annual' && kind !== 'current_period') || typeof year !== 'number') return null
  return { kind, financialYear: year }
}

export function describePeriod(override: PeriodOverride): string {
  return override.kind === 'annual'
    ? `annual, FY${override.financialYear}`
    : `current period, within FY${override.financialYear}`
}

/**
 * The pre-pass as if the headings had said what staff set. An annual file
 * keeps a comparative column when the headings showed one: the year before.
 */
export function applyPeriodOverride(
  prepass: FinancialsPrepass,
  override: PeriodOverride | null,
): { prepass: FinancialsPrepass; warning: ExtractionWarning | null } {
  if (!override) return { prepass, warning: null }
  const c = prepass.classification
  const y = override.financialYear
  const classification =
    override.kind === 'annual'
      ? { ...c, headingYears: [y], comparativeYears: c.comparativeYears.length > 0 ? [y - 1] : [], currentPeriodYear: null }
      : { ...c, headingYears: [], comparativeYears: [], currentPeriodYear: y }
  return {
    prepass: { ...prepass, classification },
    warning: {
      kind: 'period_override',
      message: `Read as ${describePeriod(override)}, as set by staff, in place of what the headings say.`,
    },
  }
}
