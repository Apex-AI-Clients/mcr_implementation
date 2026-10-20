import { differenceInCalendarDays } from 'date-fns'
import { icaPosition, type IcaRow } from '@/lib/sbr/creditorDebt'
import { classifyLodgement } from './classifyLodgement'
import { LATE_LODGEMENT_SCOPE, isCountedLodgement, lateLodgementSummary, type LateLodgementScope } from './config'
import { extractPeriodEnding, parseAtoDate } from './parseActivityStatement'
import { markBreakdownRows } from './paymentAllocations'
import type {
  ParsedCsv,
  ParsedRow,
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
 * DPN (Director Penalty Notice) estimate — SAME-PERIOD netting.
 *
 * Only an estimate, for a client with no director penalty notice on file:
 * when notices are uploaded, their own figures are shown instead
 * (src/lib/dpn/summary.ts). Rewritten 18 Oct 2026: the earlier method pooled
 * the credits of every late lodgement and applied them oldest-debit-first
 * across ALL periods, and called the result "paid since lodged". On a real
 * account with no payments at all it showed the whole late debt as "paid".
 *
 * METHOD:
 *   1. Late debits: Original/ClientAmended rows, as the late-lodgement
 *      setting counts them (config.ts), filed more than 90 days late, with a
 *      debit. Gross = their sum.
 *   2. Per period (matched on period ending), the relief is the period's NET
 *      downward amendment: the credits of its Original/ClientAmended rows,
 *      less the debits of its lodgement rows that are not counted as late
 *      debits (an amendment that went up and then back down nets to nothing).
 *      Never below $0.
 *   3. That relief reduces only that period's late debits, in date order.
 *      A credit never reduces another period's debit. A row with no period
 *      ending gets no relief.
 *
 * EXCLUSIONS: payments (we can't know which debt the ATO applied them to),
 * GIC, penalties, government credits, transfers, ATO audit amendments.
 *
 * Nothing here is a payment: the reduction is "reduced by later amendments".
 */
export function computeDpnRisk(rows: EnrichedRow[], scope: LateLodgementScope = LATE_LODGEMENT_SCOPE): DpnRiskBreakdown {
  const lodgements = rows.filter((r) => r.lodgementType === 'Original' || r.lodgementType === 'ClientAmended')
  const periodOf = (r: EnrichedRow) => (r.periodEnding ? calendarDay(r.periodEnding) : null)

  const lateDebitRows = lodgements
    .filter((r) => r.lateLodgementDays > 90 && (r.debit ?? 0) > 0 && isCountedLodgement(r, scope))
    .slice()
    .sort((a, b) => {
      const ta = a.processedDate ? (a.processedDate as Date).getTime() : 0
      const tb = b.processedDate ? (b.processedDate as Date).getTime() : 0
      if (ta !== tb) return ta - tb
      return a.rowIndex - b.rowIndex
    })
  const late = new Set(lateDebitRows)

  // Each period's net downward amendment.
  const relief = new Map<string, number>()
  const credits = new Map<string, number>()
  const otherDebits = new Map<string, number>()
  for (const r of lodgements) {
    const period = periodOf(r)
    if (!period) continue
    credits.set(period, (credits.get(period) ?? 0) + (r.credit ?? 0))
    if (!late.has(r)) otherDebits.set(period, (otherDebits.get(period) ?? 0) + (r.debit ?? 0))
  }
  for (const [period, credit] of credits) relief.set(period, Math.max(0, credit - (otherDebits.get(period) ?? 0)))

  const contributingDebits: DpnContributingDebit[] = lateDebitRows.map((row) => {
    const debit = row.debit ?? 0
    const period = periodOf(row)
    const available = period ? (relief.get(period) ?? 0) : 0
    const applied = Math.min(available, debit)
    if (period) relief.set(period, available - applied)
    return {
      rowIndex: row.rowIndex,
      processedDate: row.processedDate?.toISOString() ?? '',
      effectiveDate: row.effectiveDate?.toISOString() ?? '',
      periodEnding: row.periodEnding?.toISOString() ?? null,
      description: row.description,
      daysLate: row.lateLodgementDays,
      debit,
      reducedByAmendments: round2(applied),
      netAtRisk: round2(Math.max(debit - applied, 0)),
    }
  })

  const totalGrossLate = round2(contributingDebits.reduce((s, r) => s + r.debit, 0))
  const totalReducedByAmendments = round2(contributingDebits.reduce((s, r) => s + r.reducedByAmendments, 0))
  const totalNetAtRisk = round2(contributingDebits.reduce((s, r) => s + r.netAtRisk, 0))

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
    totalReducedByAmendments,
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
 * Audit:     ATOAudit debits/credits ("Tax Office audit amended…": debt the
 *            ATO raised on audit)
 * Payments:  Payment credits only — allocation rows (PaymentAllocation) are
 *            not payments and are skipped (paymentAllocations.ts)
 * Other:     CreditTransfer + Other credits only
 *
 * The balance owing is the ATO's own printed running balance on the newest
 * row that shows one (icaPosition — the same function the prediction's ATO
 * debt uses), never floored at $0. The composition is kept beside it; when it
 * does not reach the ATO balance, the gap is reported as an unexplained
 * difference rather than hidden.
 */
export function computeDebtBreakdown(rows: EnrichedRow[]): DebtBreakdown {
  let principalDebits = 0
  let principalCredits = 0
  let interestDebits = 0
  let interestCredits = 0
  let penaltyDebits = 0
  let penaltyCredits = 0
  let auditDebits = 0
  let auditCredits = 0
  let paymentsReceived = 0
  let paymentsCount = 0
  let firstPayment: Date | null = null
  let lastPayment: Date | null = null
  let governmentCredits = 0
  let refundsPaid = 0
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
      case 'ATOAudit':
        auditDebits += row.debit ?? 0
        auditCredits += row.credit ?? 0
        break
      case 'Payment':
        if ((row.credit ?? 0) > 0) {
          paymentsReceived += row.credit ?? 0
          paymentsCount += 1
          const d = row.effectiveDate ?? row.processedDate
          if (d) {
            if (!firstPayment || d < firstPayment) firstPayment = d
            if (!lastPayment || d > lastPayment) lastPayment = d
          }
        }
        break
      case 'Refund':
        refundsPaid += (row.debit ?? 0) - (row.credit ?? 0)
        break
      case 'GovernmentCredit':
        governmentCredits += row.credit ?? 0
        break
      case 'CreditTransfer':
      case 'Other':
        otherCredits += row.credit ?? 0
        break
      // SubLine, ATOAmended and the breakdown rows (PaymentAllocation,
      // RefundDetail, GICDetail, GICSummary) intentionally excluded
    }
  }

  // To the cent: hundreds of interest rows otherwise leave floating-point noise.
  principalDebits = round2(principalDebits)
  principalCredits = round2(principalCredits)
  interestDebits = round2(interestDebits)
  interestCredits = round2(interestCredits)
  penaltyDebits = round2(penaltyDebits)
  penaltyCredits = round2(penaltyCredits)
  auditDebits = round2(auditDebits)
  auditCredits = round2(auditCredits)
  const principalNet = round2(principalDebits - principalCredits)
  const interestNet = round2(interestDebits - interestCredits)
  const penaltyNet = round2(penaltyDebits - penaltyCredits)
  const auditNet = round2(auditDebits - auditCredits)
  const totalAtoDebt = round2(principalNet + interestNet + penaltyNet + auditNet)
  const openingBalance = openingBalanceOf(rows)
  const composedBalance = round2(openingBalance + totalAtoDebt + refundsPaid - paymentsReceived - otherCredits - governmentCredits)
  const ato = icaPosition(rows as unknown as IcaRow[])
  const atoBalance = ato.balance
  const unexplainedDifference = atoBalance === null ? null : round2(atoBalance - composedBalance)
  const currentBalance = atoBalance ?? composedBalance

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
    auditDebits,
    auditCredits,
    auditNet,
    paymentsReceived: round2(paymentsReceived),
    paymentsCount,
    firstPaymentDate: firstPayment ? calendarDay(firstPayment) : null,
    lastPaymentDate: lastPayment ? calendarDay(lastPayment) : null,
    governmentCredits: round2(governmentCredits),
    otherCredits: round2(otherCredits),
    refundsPaid: round2(refundsPaid),
    openingBalance,
    totalAtoDebt,
    composedBalance,
    atoBalance,
    atoBalanceDate: ato.balanceDate,
    unexplainedDifference,
    currentBalance,
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** A row's effect on the balance, as the composition counts it (credit-only kinds count credits only). */
function compositionEffect(row: EnrichedRow): number {
  switch (row.lodgementType) {
    case 'Original':
    case 'ClientAmended':
    case 'GIC':
    case 'FTLPenalty':
    case 'GeneralPenalty':
    case 'ATOAudit':
    case 'Refund':
      return (row.debit ?? 0) - (row.credit ?? 0)
    case 'Payment':
    case 'GovernmentCredit':
    case 'CreditTransfer':
    case 'Other':
      return -(row.credit ?? 0)
    default:
      return 0
  }
}

/**
 * The balance owed before the export's first row: the first day that prints a
 * balance, less what the rows up to and including that day account for. The
 * ATO lists newest first, so the day's balance is the first one printed on it.
 */
function openingBalanceOf(rows: EnrichedRow[]): number {
  const days = new Map<number, EnrichedRow[]>()
  for (const row of rows) {
    if (!row.processedDate) continue
    const key = row.processedDate.getTime()
    const list = days.get(key)
    if (list) list.push(row)
    else days.set(key, [row])
  }
  let counted = 0
  for (const key of [...days.keys()].sort((a, b) => a - b)) {
    const day = days.get(key)!
    counted += day.reduce((s, r) => s + compositionEffect(r), 0)
    const printed = day.find((r) => r.balance !== null)
    if (printed) {
      const opening = round2(printed.balance! - counted)
      return Math.abs(opening) < 0.005 ? 0 : opening
    }
  }
  return 0
}

/** A parser date (local midnight) as its calendar day, yyyy-mm-dd, whatever the time zone. */
function calendarDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function computeLateLodgement(parsed: ParsedCsv, scope: LateLodgementScope = LATE_LODGEMENT_SCOPE): LodgementAnalysisResult {
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

  // A total listed with the rows that break it down is one amount (paymentAllocations.ts).
  const marked = markBreakdownRows(rows)
  rows.splice(0, rows.length, ...marked)

  // Which lodgements count: one setting (config.ts), shared with the prediction.
  const { numberOfLateLodgements, cumulativeDaysLate } = lateLodgementSummary(rows, scope)

  const dpnRisk = computeDpnRisk(rows, scope)
  const debtBreakdown = computeDebtBreakdown(rows)

  return {
    summary: { numberOfLateLodgements, cumulativeDaysLate },
    dpnRisk,
    debtBreakdown,
    rows,
    warnings,
  }
}

/**
 * The analysis again, from rows stored in lodgement_analyses.rows: the stored
 * totals (dpn_risk, debt_breakdown) are whatever the code computed on the day,
 * so the report re-runs the current code over the stored rows instead. Dates
 * are re-read from the raw cells, as the parser reads them. Null when the rows
 * are not in the stored shape.
 */
export function reanalyseStoredRows(stored: unknown, scope: LateLodgementScope = LATE_LODGEMENT_SCOPE): LodgementAnalysisResult | null {
  if (!Array.isArray(stored) || stored.length === 0) return null
  const rows: ParsedRow[] = []
  for (const [i, raw] of stored.entries()) {
    const r = raw as Record<string, unknown>
    if (typeof r.description !== 'string' || typeof r.rawProcessed !== 'string' || typeof r.rawEffective !== 'string') {
      return null
    }
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
    rows.push({
      rowIndex: typeof r.rowIndex === 'number' ? r.rowIndex : i,
      processedDate: parseAtoDate(r.rawProcessed),
      effectiveDate: parseAtoDate(r.rawEffective),
      rawProcessed: r.rawProcessed,
      rawEffective: r.rawEffective,
      description: r.description,
      debit: num(r.debit),
      credit: num(r.credit),
      balance: num(r.balance),
      periodEnding: extractPeriodEnding(r.description),
    })
  }
  return computeLateLodgement({ statementLabel: '', companyName: '', rows }, scope)
}
