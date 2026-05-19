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
 * DPN (Director Penalty Notice) risk — pooled-credit netting methodology.
 *
 * Updated 19 May 2026 after MCR feedback (PARKCON reference dataset):
 *   gross late debt   = $9,408
 *   paid since lodged = $8,534  (sum of late credit-only ClientAmended rows)
 *   net at risk       = $874
 *
 * Rationale (per MCR): the ATO applies cash payments to the oldest outstanding
 * debt first, so a cash payment can be consumed by an older non-DPN debit
 * (GIC, prior on-time lodgement, etc.) without de-risking the DPN-qualifying
 * late lodgement at all. We can't know for any given payment what it actually
 * paid down. The conservative position is therefore to NOT credit any cash
 * payments toward DPN relief.
 *
 * Late credit-only ClientAmended rows ARE counted as relief, because an
 * amendment that reduces a prior-period liability is directly tied to that
 * period's lodgement debt and is a real reversal of personal liability — even
 * though it was filed late.
 *
 * METHOD:
 *   1. Identify all Original/ClientAmended rows filed >90 days late.
 *   2. Split into debit rows (debit > 0) and credit rows (credit > 0).
 *      Total Gross Late   = sum of debits.
 *      Total Credit Pool  = sum of credits.
 *   3. Apply the credit pool oldest-debit-first to allocate per-row
 *      paymentsSinceLodged and netAtRisk for display. Total paid = min(pool,
 *      gross); total net = max(0, gross - pool).
 *
 * EXCLUSIONS:
 *   - Cash Payment rows: ignored.
 *   - Government stimulus (Cash Flow Boost, JobKeeper), credit transfers,
 *     GIC remissions, ATO-initiated amendments: ignored.
 *   - Credit-only late amendments themselves are NOT contributing debits
 *     (debit = 0), but their credit amount IS added to the credit pool.
 */
export function computeDpnRisk(rows: EnrichedRow[]): DpnRiskBreakdown {
  const lateOriginalAmend = rows.filter(
    (r) =>
      (r.lodgementType === 'Original' || r.lodgementType === 'ClientAmended') &&
      r.lateLodgementDays > 90,
  )

  const lateDebitRows = lateOriginalAmend
    .filter((r) => (r.debit ?? 0) > 0)
    .slice()
    .sort((a, b) => {
      const ta = a.processedDate ? (a.processedDate as Date).getTime() : 0
      const tb = b.processedDate ? (b.processedDate as Date).getTime() : 0
      if (ta !== tb) return ta - tb
      return a.rowIndex - b.rowIndex
    })

  const totalGrossLate = lateDebitRows.reduce((s, r) => s + (r.debit ?? 0), 0)
  const totalCreditPool = lateOriginalAmend.reduce((s, r) => s + (r.credit ?? 0), 0)

  // Allocate the pooled credit oldest-debit-first for per-row display values.
  let creditRemaining = totalCreditPool
  const contributingDebits: DpnContributingDebit[] = lateDebitRows.map((row) => {
    const debit = row.debit ?? 0
    const applied = Math.min(creditRemaining, debit)
    creditRemaining -= applied
    return {
      rowIndex: row.rowIndex,
      processedDate: row.processedDate?.toISOString() ?? '',
      effectiveDate: row.effectiveDate?.toISOString() ?? '',
      periodEnding: row.periodEnding?.toISOString() ?? null,
      description: row.description,
      daysLate: row.lateLodgementDays,
      debit,
      paymentsSinceLodged: applied,
      netAtRisk: Math.max(debit - applied, 0),
    }
  })

  const totalPaidSince = Math.min(totalCreditPool, totalGrossLate)
  const totalNetAtRisk = Math.max(0, totalGrossLate - totalCreditPool)

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
