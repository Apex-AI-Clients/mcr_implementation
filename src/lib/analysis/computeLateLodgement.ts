import { differenceInCalendarDays } from 'date-fns'
import { classifyLodgement } from './classifyLodgement'
import type {
  ParsedCsv,
  EnrichedRow,
  AnalysisWarning,
  LodgementAnalysisResult,
  DpnRiskBreakdown,
  DpnContributingRow,
  DebtBreakdown,
} from './types'

/**
 * Sign convention for lateLodgementDays:
 *   Negative  — lodged before the statutory due date (on time / early). Normal.
 *   Zero      — lodged on the due date, or not a lodgement row.
 *   Positive  — lodged after the due date — genuinely late by N calendar days.
 *
 * lateLodgeDaysCleaned = max(lateLodgementDays, 0)
 *
 * Calendar days are used (not business days). The ATO measures lateness in
 * calendar days and already accounts for weekends/holidays in the Effective Date.
 */

/**
 * DPN (Director Penalty Notice) risk using the confirmed client methodology:
 *
 * Qualifying rows: lodgementType ∈ {Original, ClientAmended} AND lateLodgementDays > 90 (strict).
 * Both debit rows (gross liability added) and credit rows (reversals) are collected.
 *
 * totalGrossLate = sum of debit across ALL qualifying rows
 * totalReversed  = sum of credit across ALL qualifying rows
 * totalNetAtRisk = max(totalGrossLate − totalReversed, 0)
 *
 * No period-matching. No payment attribution. Credits that happen to be on a
 * >90-day-late ClientAmended row reduce the gross directly.
 *
 * periodStart/periodEnd reflect the full range of ALL processedDates in the CSV —
 * not just the DPN-qualifying subset.
 */
export function computeDpnRisk(rows: EnrichedRow[]): DpnRiskBreakdown {
  const contributingRows: DpnContributingRow[] = rows
    .filter(
      (r) =>
        (r.lodgementType === 'Original' || r.lodgementType === 'ClientAmended') &&
        r.lateLodgementDays > 90,
    )
    .map((r) => ({
      rowIndex: r.rowIndex,
      processedDate: r.processedDate?.toISOString() ?? '',
      effectiveDate: r.effectiveDate?.toISOString() ?? '',
      periodEnding: r.periodEnding?.toISOString() ?? null,
      description: r.description,
      daysLate: r.lateLodgementDays,
      debit: r.debit ?? 0,
      credit: r.credit ?? 0,
    }))

  const totalGrossLate = contributingRows.reduce((s, r) => s + r.debit, 0)
  const totalReversed = contributingRows.reduce((s, r) => s + r.credit, 0)
  const totalNetAtRisk = Math.max(totalGrossLate - totalReversed, 0)

  const allProcessedDates = rows
    .map((r) => r.processedDate)
    .filter((d): d is Date => d !== null)
    .map((d) => d.getTime())
    .sort((a, b) => a - b)

  const periodStart = allProcessedDates.length > 0
    ? new Date(allProcessedDates[0]).toISOString()
    : null
  const periodEnd = allProcessedDates.length > 0
    ? new Date(allProcessedDates[allProcessedDates.length - 1]).toISOString()
    : null

  return {
    thresholdDays: 90,
    contributingRows,
    totalGrossLate,
    totalReversed,
    totalNetAtRisk,
    periodStart,
    periodEnd,
  }
}

/**
 * Debt composition breakdown. Excludes SubLine rows (they double-count parent
 * amounts) and ATOAmended rows (ATO-initiated corrections already reflected in
 * the overall balance).
 *
 * Principal: Original + ClientAmended debits/credits
 * Interest:  GIC debits/credits (includes remissions as credits)
 * Penalties: FTLPenalty + GeneralPenalty debits/credits
 * Payments:  Payment credits only
 * Other:     CreditTransfer + Other credits only
 */
export function computeDebtBreakdown(rows: EnrichedRow[]): DebtBreakdown {
  let principalDebits = 0
  let principalCredits = 0
  let interestDebits = 0
  let interestCredits = 0
  let penaltyDebits = 0
  let penaltyCredits = 0
  let paymentsReceived = 0
  let governmentCredits = 0
  let otherCredits = 0

  for (const row of rows) {
    switch (row.lodgementType) {
      case 'Original':
      case 'ClientAmended':
        principalDebits += row.debit ?? 0
        principalCredits += row.credit ?? 0
        break
      case 'GIC':
        interestDebits += row.debit ?? 0
        interestCredits += row.credit ?? 0
        break
      case 'FTLPenalty':
      case 'GeneralPenalty':
        penaltyDebits += row.debit ?? 0
        penaltyCredits += row.credit ?? 0
        break
      case 'Payment':
        paymentsReceived += row.credit ?? 0
        break
      case 'GovernmentCredit':
        governmentCredits += row.credit ?? 0
        break
      case 'CreditTransfer':
      case 'Other':
        otherCredits += row.credit ?? 0
        break
      // SubLine and ATOAmended intentionally excluded
    }
  }

  const principalNet = principalDebits - principalCredits
  const interestNet = interestDebits - interestCredits
  const penaltyNet = penaltyDebits - penaltyCredits
  const totalAtoDebt = principalNet + interestNet + penaltyNet
  const currentBalance = Math.max(
    totalAtoDebt - paymentsReceived - otherCredits - governmentCredits,
    0,
  )

  return {
    principalDebits,
    principalCredits,
    principalNet,
    interestDebits,
    interestCredits,
    interestNet,
    penaltyDebits,
    penaltyCredits,
    penaltyNet,
    paymentsReceived,
    governmentCredits,
    otherCredits,
    totalAtoDebt,
    currentBalance,
  }
}

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

    const lateLodgeDaysCleaned = Math.max(lateLodgementDays, 0)

    rows.push({ ...row, lodgementType, lateLodgementDays, lateLodgeDaysCleaned })
  }

  const numberOfLateLodgements = rows.filter((r) => r.lateLodgeDaysCleaned > 0).length
  const cumulativeDaysLate = rows.reduce((sum, r) => sum + r.lateLodgeDaysCleaned, 0)

  const dpnRisk = computeDpnRisk(rows)
  const debtBreakdown = computeDebtBreakdown(rows)

  return {
    summary: { numberOfLateLodgements, cumulativeDaysLate },
    dpnRisk,
    debtBreakdown,
    rows,
    warnings,
  }
}
