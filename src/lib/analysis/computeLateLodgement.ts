import { differenceInCalendarDays } from 'date-fns'
import { classifyLodgement } from './classifyLodgement'
import type {
  ParsedCsv,
  EnrichedRow,
  AnalysisWarning,
  LodgementAnalysisResult,
} from './types'

/**
 * Sign convention for lateLodgementDays:
 *   Negative  — lodged before the statutory due date (on time / early). Normal.
 *   Zero      — lodged on the due date, or not a lodgement row.
 *   Positive  — lodged after the due date — genuinely late by N calendar days.
 *
 * lateLodgeDaysCleaned = max(lateLodgementDays, 0)
 * The ATO does not credit early lodgements — only positive lateness counts
 * toward compliance scoring.
 *
 * Calendar days are used (not business days). The ATO measures lateness in
 * calendar days and already accounts for weekends/holidays in the Effective Date.
 */
export function computeLateLodgement(parsed: ParsedCsv): LodgementAnalysisResult {
  const warnings: AnalysisWarning[] = []
  const rows: EnrichedRow[] = []

  for (const row of parsed.rows) {
    const lodgementType = classifyLodgement(row.description)

    let lateLodgementDays = 0

    if (lodgementType === 'Original' || lodgementType === 'ClientAmended') {
      if (row.processedDate === null || row.effectiveDate === null) {
        warnings.push({
          rowIndex: row.rowIndex,
          reason: 'missing_dates_on_lodgement',
          rawProcessed: row.rawProcessed,
          rawEffective: row.rawEffective,
          description: row.description,
        })
        lateLodgementDays = 0
      } else {
        lateLodgementDays = differenceInCalendarDays(row.processedDate, row.effectiveDate)
      }
    }

    // max(lateLodgementDays, 0) — negatives mean on-time/early, which don't count
    const lateLodgeDaysCleaned = Math.max(lateLodgementDays, 0)

    rows.push({ ...row, lodgementType, lateLodgementDays, lateLodgeDaysCleaned })
  }

  const numberOfLateLodgements = rows.filter((r) => r.lateLodgeDaysCleaned > 0).length
  const cumulativeDaysLate = rows.reduce((sum, r) => sum + r.lateLodgeDaysCleaned, 0)

  return {
    summary: { numberOfLateLodgements, cumulativeDaysLate },
    rows,
    warnings,
  }
}
