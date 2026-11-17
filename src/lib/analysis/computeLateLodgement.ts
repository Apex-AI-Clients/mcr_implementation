import { differenceInCalendarDays } from 'date-fns'
import { icaPosition, type IcaRow } from '@/lib/sbr/creditorDebt'
import { classifyLodgement } from './classifyLodgement'
import { LATE_LODGEMENT_PHRASE, LATE_LODGEMENT_SCOPE, isCountedLodgement, lateLodgementSummary, unparsedDateRows, type LateLodgementScope } from './config'
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
 * DPN (Director Penalty Notice) estimate — payments since the balance was last
 * nil, applied to the oldest debts first.
 *
 * Only an estimate, for a client with no director penalty notice on file:
 * when notices are uploaded, their own figures are shown instead
 * (src/lib/dpn/summary.ts). Rewritten 16 Nov 2026 to the practitioner's method
 * (MBM Landscaping, email to Gabby): until then payments were ignored and the
 * gross late debt of the WHOLE history was shown as still owing.
 *
 * METHOD:
 *   1. Window. The last row (in date order) whose printed ATO balance was nil
 *      or in credit (≤ $0): everything before it was paid. The window is the
 *      rows after it. A credit held then is money on the account and is
 *      applied like a payment. When the balance is never nil in the export,
 *      the window is the whole export and the balance it opens with is the
 *      oldest debt. The last date at or under $1,000 is reported for information.
 *   2. Late debits: in the window, the rows the late-lodgement setting counts
 *      (config.ts), filed more than 90 days late, with a debit. Gross = their
 *      sum.
 *   3. Amendments (unchanged rule): per period, the credits of its statement
 *      rows reduce that period's own debits — those not filed > 90 days late
 *      first (an amendment that went up and back down nets to nothing), then
 *      the late ones in date order. A credit never reduces another period's
 *      debit; a penalty remission relieves nothing.
 *   4. Payments: every payment in the window (allocation rows not counted
 *      twice), in date order, goes to the tax debts already on the account
 *      in due-date order (effective date), the ATO's usual oldest-first
 *      practice; what is left over waits for the next debt. Tax debts are the
 *      activity statement rows, ATO audit amendments and PAYG withholding
 *      (STP reported) — not interest or penalties.
 *   5. Estimated still owing: the late debt neither amended away nor reached
 *      by a payment.
 *
 * Other credits (government credits, transfers, credit statements of other
 * periods) are not applied: the estimate leans towards "still owing".
 */
export function computeDpnRisk(printedRows: EnrichedRow[], scope: LateLodgementScope = LATE_LODGEMENT_SCOPE): DpnRiskBreakdown {
  // Each tax line on its own (Gabby, 17 Nov 2026: the ATO issues separate GST and PAYGW notices): a
  // statement's "- GST" and "- PAYG Withholding" sub-lines are its amounts, so a GST credit never
  // offsets PAYG. A statement printed without sub-lines keeps its own amount.
  const rows = byTaxLine(printedRows)
  const isPenalty = (r: EnrichedRow) => r.lodgementType === 'FTLPenalty' || r.lodgementType === 'GeneralPenalty'
  const periodOf = (r: EnrichedRow) => (r.periodEnding ? calendarDay(r.periodEnding) : null)
  const isLateDebit = (r: EnrichedRow) => r.lateLodgementDays > 90 && (r.debit ?? 0) > 0 && isCountedLodgement(r, scope)

  // 1. The window: rows after the last nil-or-credit balance, in date order.
  const chron = chronological(rows)
  const lastAtOrBelow = (limit: number) => {
    for (let i = chron.length - 1; i >= 0; i--) {
      const balance = chron[i].balance
      if (balance !== null && balance <= limit + 0.005) return i
    }
    return -1
  }
  const anchor = lastAtOrBelow(0)
  const anchorUnder1000 = lastAtOrBelow(1000)
  const window = chron.slice(anchor + 1)
  const position = new Map(window.map((r, i) => [r, i]))
  const startingCredit = anchor >= 0 ? round2(Math.max(0, -(chron[anchor].balance ?? 0))) : 0
  const openingDebt = anchor >= 0 ? 0 : Math.max(0, openingBalanceOf(rows))

  // 2–3. Late debits, and each period's amendment credits applied to its own debits.
  const lodgements = new Set(
    window.filter(
      (r) => r.lodgementType === 'Original' || r.lodgementType === 'ClientAmended' || (isCountedLodgement(r, scope) && !isPenalty(r)),
    ),
  )
  // Amendment credits reduce the same period's debits OF THE SAME TAX LINE only.
  const lineOf = (r: EnrichedRow) => (r as TaxLineRow).taxLine ?? ''
  const periodKey = (r: EnrichedRow) => {
    const period = periodOf(r)
    return period ? `${period}|${lineOf(r)}` : null
  }
  const credits = new Map<string, number>()
  for (const r of lodgements) {
    const period = periodKey(r)
    if (period) credits.set(period, (credits.get(period) ?? 0) + (r.credit ?? 0))
  }
  const taxDebits = new Set(
    window.filter(
      (r) =>
        (r.debit ?? 0) > 0 &&
        (isLateDebit(r) || lodgements.has(r) || r.lodgementType === 'PAYGWithholding' || r.lodgementType === 'ATOAudit'),
    ),
  )
  const reduced = new Map<EnrichedRow, number>()
  // The period's other debits take its credits first, then its late debits, each in date order.
  for (const late of [false, true]) {
    for (const r of window) {
      if (!taxDebits.has(r) || !lodgements.has(r) || isLateDebit(r) !== late) continue
      const period = periodKey(r)
      if (!period) continue
      const available = credits.get(period) ?? 0
      const applied = Math.min(available, r.debit ?? 0)
      credits.set(period, available - applied)
      reduced.set(r, applied)
    }
  }

  // 4. Payments, oldest debt first; a surplus waits for the next debt.
  interface Debt { row: EnrichedRow | null; due: number; order: number; left: number }
  const dueOf = (r: EnrichedRow) => (r.effectiveDate ?? r.processedDate)?.getTime() ?? 0
  const open: Debt[] = []
  const paid = new Map<EnrichedRow, number>()
  if (openingDebt > 0) open.push({ row: null, due: -Infinity, order: -1, left: round2(openingDebt) })
  let carry = startingCredit
  let payments = 0
  let paymentsCount = 0
  const applyCarry = () => {
    for (const d of open.filter((x) => x.left > 0).sort((a, b) => a.due - b.due || a.order - b.order)) {
      if (carry <= 0) break
      const applied = Math.min(carry, d.left)
      d.left = round2(d.left - applied)
      carry = round2(carry - applied)
      if (d.row) paid.set(d.row, round2((paid.get(d.row) ?? 0) + applied))
    }
  }
  window.forEach((r, order) => {
    if (taxDebits.has(r)) {
      open.push({ row: r, due: dueOf(r), order, left: round2((r.debit ?? 0) - (reduced.get(r) ?? 0)) })
      applyCarry()
    } else if (r.lodgementType === 'Payment' && (r.credit ?? 0) > 0) {
      payments += r.credit ?? 0
      paymentsCount++
      carry = round2(carry + (r.credit ?? 0))
      applyCarry()
    }
  })

  // 5. The late debits, as reported (in the order the ATO processed them).
  const contributingDebits: DpnContributingDebit[] = window
    .filter(isLateDebit)
    .sort((a, b) => position.get(a)! - position.get(b)!)
    .map((row) => {
      const debit = row.debit ?? 0
      const amended = reduced.get(row) ?? 0
      const byPayments = paid.get(row) ?? 0
      return {
        rowIndex: row.rowIndex,
        processedDate: row.processedDate?.toISOString() ?? '',
        effectiveDate: row.effectiveDate?.toISOString() ?? '',
        periodEnding: row.periodEnding?.toISOString() ?? null,
        description: row.description,
        taxLine: (row as TaxLineRow).taxLine,
        daysLate: row.lateLodgementDays,
        debit,
        reducedByAmendments: round2(amended),
        paidByPayments: round2(byPayments),
        netAtRisk: round2(Math.max(debit - amended - byPayments, 0)),
      }
    })

  const total = (f: (d: DpnContributingDebit) => number) => round2(contributingDebits.reduce((s, r) => s + f(r), 0))
  const totalGrossLate = total((r) => r.debit)
  const totalReducedByAmendments = total((r) => r.reducedByAmendments)
  const totalPaidByPayments = total((r) => r.paidByPayments ?? 0)
  const totalNetAtRisk = total((r) => r.netAtRisk)
  let otherTaxDebts = openingDebt
  for (const r of taxDebits) if (!isLateDebit(r)) otherTaxDebts += (r.debit ?? 0) - (reduced.get(r) ?? 0)

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

  const dayAt = (i: number) => {
    const d = i >= 0 ? chron[i].processedDate : null
    return d ? calendarDay(d) : null
  }
  return {
    thresholdDays: 90,
    method: 'payments_oldest_first',
    contributingDebits,
    totalGrossLate,
    totalReducedByAmendments,
    totalPaidByPayments,
    totalNetAtRisk,
    window: {
      start: dayAt(anchor),
      startBalance: anchor >= 0 ? chron[anchor].balance : null,
      startUnder1000: dayAt(anchorUnder1000),
      startingCredit,
      openingDebt: round2(openingDebt),
      payments: round2(payments),
      paymentsCount,
      otherTaxDebts: round2(otherTaxDebts),
      otherTaxDebtsPaid: round2(payments + startingCredit - carry - totalPaidByPayments),
      grossLateAllHistory: round2(rows.filter(isLateDebit).reduce((s, r) => s + (r.debit ?? 0), 0)),
    },
    periodStart,
    periodEnd,
  }
}

/** A row of the DPN estimate: a statement's tax line ("GST", "PAYG Withholding"), when it has sub-lines. */
type TaxLineRow = EnrichedRow & { taxLine?: string }

/**
 * The statements by tax line, for the DPN estimate's arithmetic only (the
 * stored rows stay exactly as printed). Each "- GST" / "- PAYG Withholding"
 * sub-line printed under a statement row (same processed date) becomes a row
 * of that statement — its dates, period, kind and days late — with the
 * sub-line's own amount, its own position (rowIndex) and the tax line named in
 * its description. The statement row itself then carries only what its
 * sub-lines do not account for, usually nothing (its balance stays). A
 * statement row with no sub-lines is left as it is.
 */
export function byTaxLine(rows: EnrichedRow[]): EnrichedRow[] {
  const isStatement = (r: EnrichedRow) =>
    r.lodgementType === 'Original' || r.lodgementType === 'ClientAmended' || r.lodgementType === 'ATOAmended' || r.lodgementType === 'ATOAudit'
  const out: EnrichedRow[] = []
  for (let i = 0; i < rows.length; i++) {
    const head = rows[i]
    if (!isStatement(head)) {
      out.push(head)
      continue
    }
    const subs: EnrichedRow[] = []
    for (let j = i + 1; j < rows.length && rows[j].lodgementType === 'SubLine' && rows[j].rawProcessed.trim() === head.rawProcessed.trim(); j++) subs.push(rows[j])
    if (subs.length === 0) {
      out.push(head)
      continue
    }
    // Sub-lines that do not add up to an amount printed on the statement row: the rest stays on the
    // statement row (as the ICA engine reads it, src/lib/ica/compose.ts); nothing is lost or doubled.
    const cents = (r: EnrichedRow) => Math.round(((r.debit ?? 0) - (r.credit ?? 0)) * 100)
    const rest = (head.debit ?? head.credit ?? 0) === 0 ? 0 : cents(head) - subs.reduce((t, r) => t + cents(r), 0)
    out.push({ ...head, debit: rest > 0 ? rest / 100 : null, credit: rest < 0 ? -rest / 100 : null })
    for (const sub of subs) {
      const taxLine = sub.description.replace(/^'/, '').replace(/^-\s*/, '').trim()
      out.push({ ...head, rowIndex: sub.rowIndex, description: `${head.description} — ${taxLine}`, debit: sub.debit, credit: sub.credit, balance: null, taxLine } as TaxLineRow)
    }
    i += subs.length
  }
  return out
}

/**
 * The rows in date order, oldest first. The ATO lists newest first; within a
 * day the file order is kept (reversed), so the allocation rows printed
 * under a payment come before it and the window starts after them.
 */
function chronological(rows: EnrichedRow[]): EnrichedRow[] {
  const dated = rows.filter((r) => r.processedDate)
  const first = dated[0]?.processedDate?.getTime() ?? 0
  const last = dated[dated.length - 1]?.processedDate?.getTime() ?? 0
  const base = first < last ? [...rows] : [...rows].reverse()
  // A stable sort by processed date: a file not in date order is still read in date order.
  // A row without a date keeps its place (it takes the date of the row before it).
  let previous = -Infinity
  const keyed = base.map((row, i) => {
    previous = row.processedDate?.getTime() ?? previous
    return { row, time: previous, i }
  })
  return keyed.sort((a, b) => a.time - b.time || a.i - b.i).map((k) => k.row)
}

/**
 * Debt composition breakdown. Excludes SubLine rows (they double-count parent
 * amounts) and ATOAmended rows (ATO-initiated corrections already reflected in
 * the overall balance).
 *
 * Principal: Original + ClientAmended + PAYGWithholding (STP reported) debits/credits
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
      case 'PAYGWithholding':
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
    case 'PAYGWithholding':
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

    // Days late are measured on statements and, as the RBA ICA spreadsheet does,
    // on every row whose description carries "Activity Statement" (config.ts).
    if (lodgementType === 'Original' || lodgementType === 'ClientAmended' || LATE_LODGEMENT_PHRASE.test(row.description)) {
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
    // A row without both dates cannot be measured: counted, and the analysis fails visibly (never read as on time).
    unparsedDateRows: unparsedDateRows(rows),
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
