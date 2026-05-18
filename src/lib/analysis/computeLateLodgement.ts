import { differenceInCalendarDays } from 'date-fns'
import { classifyLodgement } from './classifyLodgement'
import type {
  ParsedCsv,
  EnrichedRow,
  AnalysisWarning,
  LodgementAnalysisResult,
  DpnRiskBreakdown,
  DpnContributingDebit,
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
 * DPN (Director Penalty Notice) risk — corrected methodology, confirmed by client
 * (Gabby, MCR Partners) on 15 May 2026.
 *
 * For each Original/ClientAmended lodgement filed more than 90 days late AND with
 * a positive debit, sum cash payments (type === 'Payment') processed on or after
 * that lodgement's processedDate. Cap the per-row payment total at the row's debit
 * amount — a payment cannot reduce a single debt below zero.
 *
 * RULES (do not change without re-confirmation with the client):
 *   1. Per-row, not aggregate. Each contributing debit is independently netted
 *      against payments after its own date.
 *   2. Cash payments only. Government stimulus credits (Cash Flow Boost, JobKeeper)
 *      and credit transfers from other ATO accounts are EXCLUDED — they reduce the
 *      balance but are "the ATO's own money" and do not relieve personal DPN
 *      liability.
 *   3. GIC remissions are EXCLUDED. They are paper adjustments, not payments.
 *   4. Credit-only late amendments are NOT contributing debits. They don't
 *      represent a personal-liability event.
 *
 * VALIDATION:
 *   For the PARKCON PTY LTD reference dataset, this produces:
 *     totalGrossLate  = $9,408   (one contributing debit)
 *     totalPaidSince  = $9,408   (capped — actual payments since were $362,335)
 *     totalNetAtRisk  = $0
 *   These figures are regression-tested.
 */
export function computeDpnRisk(rows: EnrichedRow[]): DpnRiskBreakdown {
  // Filter to qualifying late debit lodgements
  const lateDebits = rows.filter(
    (r) =>
      (r.lodgementType === 'Original' || r.lodgementType === 'ClientAmended') &&
      r.lateLodgementDays > 90 &&
      (r.debit ?? 0) > 0,
  )

  // Cash payments only — explicitly NOT GovernmentCredit, NOT CreditTransfer, NOT GIC remissions.
  const paymentRows = rows.filter((r) => r.lodgementType === 'Payment' && r.processedDate !== null)

  const contributingDebits: DpnContributingDebit[] = lateDebits.map((row) => {
    const debit = row.debit ?? 0
    const lodgedAt = row.processedDate as Date // non-null because lateLodgementDays > 0 requires both dates

    // Sum payments processed on or after the lodgement date
    const paymentsSince = paymentRows
      .filter((p) => (p.processedDate as Date) >= lodgedAt)
      .reduce((sum, p) => sum + (p.credit ?? 0), 0)

    const paymentsSinceLodged = Math.min(paymentsSince, debit) // cap at debit
    const netAtRisk = Math.max(debit - paymentsSinceLodged, 0)

    return {
      rowIndex: row.rowIndex,
      processedDate: row.processedDate?.toISOString() ?? '',
      effectiveDate: row.effectiveDate?.toISOString() ?? '',
      periodEnding: row.periodEnding?.toISOString() ?? null,
      description: row.description,
      daysLate: row.lateLodgementDays,
      debit,
      paymentsSinceLodged,
      netAtRisk,
    }
  })

  const totalGrossLate = contributingDebits.reduce((s, r) => s + r.debit, 0)
  const totalPaidSince = contributingDebits.reduce((s, r) => s + r.paymentsSinceLodged, 0)
  const totalNetAtRisk = contributingDebits.reduce((s, r) => s + r.netAtRisk, 0)

  // periodStart/periodEnd reflect the full range of all processedDates in the CSV
  const allProcessedTimes = rows
    .map((r) => r.processedDate)
    .filter((d): d is Date => d !== null)
    .map((d) => d.getTime())
    .sort((a, b) => a - b)

  const periodStart = allProcessedTimes.length > 0 ? new Date(allProcessedTimes[0]).toISOString() : null
  const periodEnd =
    allProcessedTimes.length > 0
      ? new Date(allProcessedTimes[allProcessedTimes.length - 1]).toISOString()
      : null

  return {
    thresholdDays: 90,
    contributingDebits,
    totalGrossLate,
    totalPaidSince,
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
