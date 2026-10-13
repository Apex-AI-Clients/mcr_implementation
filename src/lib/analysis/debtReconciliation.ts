import type { DebtBreakdown } from './types'

/**
 * How the Debt Composition table reaches the balance owing. The balance is the
 * ATO's own printed figure; the categories above it are summed from the rows.
 * When the two differ (amounts the export does not itemise, rounding,
 * transfers), the gap is shown as its own line so the table adds up on screen,
 * in the CSV export and in the PDF alike. Pure; safe in the browser.
 */

/** Gaps of a dollar or less are rounding, not worth a line. */
export const RECONCILIATION_THRESHOLD = 1

export const RECONCILIATION_LABEL = 'Other adjustments / unexplained difference vs ATO balance'

/** Opening balance plus total debt and refunds paid out, less payments and credits: what the itemised rows add up to. */
export function composedBalance(db: DebtBreakdown): number {
  // Analyses saved before these lines existed carry neither field.
  const refunds = db.refundsPaid ?? 0
  const opening = db.openingBalance ?? 0
  return round2(opening + db.totalAtoDebt + refunds - db.paymentsReceived - db.governmentCredits - db.otherCredits)
}

/**
 * The balance owing less what the rows add up to: positive when the ATO
 * balance is higher. Null when it is within the threshold (no line needed).
 * Works for analyses saved before the ATO balance was used too: their balance
 * was the composition itself, so there is no gap.
 */
export function reconciliationGap(db: DebtBreakdown): number | null {
  const gap = round2(db.currentBalance - composedBalance(db))
  return Math.abs(gap) > RECONCILIATION_THRESHOLD ? gap : null
}

const round2 = (n: number) => Math.round(n * 100) / 100
