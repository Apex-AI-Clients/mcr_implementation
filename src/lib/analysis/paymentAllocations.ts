import type { EnrichedRow, LodgementType } from './types'

/**
 * Breakdown rows in an ATO activity statement export.
 *
 * The ATO lists some transactions as a total row WITH a balance, followed by
 * rows with NO balance, on the same processed and effective dates, that only
 * break that total down and add up to it. Counting both counts the money
 * twice. Three patterns occur:
 *
 *   Payment received  $10,000.00  $80,000.00 DR    ← one payment
 *   Payment received   $6,000.00                    ← how it was allocated
 *   Payment received   $4,000.00
 *
 *   Refund                        $5,000.00  $3,000.00 DR   ← one refund paid out
 *   EFT refund for GST for the period…        $2,000.00     ← what it was for
 *   EFT refund for PAYG Withholding…          $3,000.00
 *
 *   General interest charge        $2,000.00  $1,000.00 DR  ← one remission total
 *   Remission of general interest charge         $250.00    ← its parts (×8)
 *
 * The total row stays as it is; the rows that only break it down are re-typed
 * (PaymentAllocation, RefundDetail, GICDetail) so every count and total skips
 * them. They stay in the rows for display.
 *
 * The rule, per total row (its description is exactly the total's label, it
 * has a balance and an amount): take the no-balance rows of the same kind,
 * on the same processed and effective dates and on the same side (debit or
 * credit), directly below it — or, failing that, directly above it — in
 * order, adding them up. If the running sum reaches the total exactly (to the
 * cent), those rows are its breakdown. If it passes the total, or a row breaks
 * the run, nothing is re-typed. So two genuine transactions on the same day
 * are never merged unless one is exactly the breakdown of the other.
 */

interface Pattern {
  /** The kind of row (classifyLodgement) both the total and its breakdown have. */
  type: LodgementType
  /** The total row's description, lower case, with the ATO's leading apostrophe removed. */
  totalLabel: RegExp
  side: 'credit' | 'debit'
  detailType: LodgementType
}

const PATTERNS: Pattern[] = [
  { type: 'Payment', totalLabel: /^payment received$/, side: 'credit', detailType: 'PaymentAllocation' },
  { type: 'Refund', totalLabel: /^refund$/, side: 'debit', detailType: 'RefundDetail' },
  { type: 'GIC', totalLabel: /^general interest charge$/, side: 'credit', detailType: 'GICDetail' },
]

const label = (description: string) => description.replace(/^'/, '').trim().toLowerCase()

const sameDates = (a: EnrichedRow, b: EnrichedRow) =>
  a.rawProcessed.trim() === b.rawProcessed.trim() && a.rawEffective.trim() === b.rawEffective.trim()

const cents = (n: number) => Math.round(n * 100)

export function markBreakdownRows(rows: EnrichedRow[]): EnrichedRow[] {
  const detail = new Map<number, LodgementType>()

  rows.forEach((total, i) => {
    const pattern = PATTERNS.find((p) => p.type === total.lodgementType && p.totalLabel.test(label(total.description)))
    if (!pattern || total.balance === null) return
    const amount = total[pattern.side]
    const other = pattern.side === 'credit' ? 'debit' : 'credit'
    if (!amount || amount <= 0 || total[other]) return
    const target = cents(amount)

    for (const step of [1, -1]) {
      let sum = 0
      const run: number[] = []
      for (let j = i + step; j >= 0 && j < rows.length; j += step) {
        const row = rows[j]
        const value = row[pattern.side]
        const isPart =
          row.lodgementType === pattern.type &&
          row.balance === null &&
          !!value &&
          value > 0 &&
          !row[other] &&
          !detail.has(j) &&
          sameDates(row, total)
        if (!isPart) break
        sum += cents(value)
        run.push(j)
        if (sum === target) {
          run.forEach((k) => detail.set(k, pattern.detailType))
          return
        }
        if (sum > target) break
      }
    }
  })

  if (detail.size === 0) return rows
  return rows.map((row, i) => (detail.has(i) ? { ...row, lodgementType: detail.get(i)! } : row))
}

/** The payment case alone, kept for callers that use this name. */
export const markPaymentAllocations = markBreakdownRows
