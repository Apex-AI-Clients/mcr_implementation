import { calendarDay, periodOf, type AccountRow, type AtoAccountCore } from './engine'

/**
 * The income tax account's own summary: each assessment, payments, and the
 * interest charged and remitted. Pure.
 *
 * There is no "days late": the export carries no lodgement due date. Each
 * assessment shows when it was assessed (the processed date), when payment
 * was due (the effective date), and — while any of it is still owing — how
 * many days past that due date it has been unpaid, as at the balance date.
 *
 * Which assessments are still owing: the ATO's balance is taken to be made
 * up of the newest charges, i.e. payments and credits are applied to the
 * oldest debts first. Walking the charges from newest to oldest until the
 * balance is used up gives what of each is unpaid.
 */

export interface IncomeTaxAssessment {
  rowIndex: number
  /** "for the period from 01 Jul 24 to 30 Jun 25". */
  period: { from: string; to: string } | null
  description: string
  amount: number
  /** Processed date: when the ATO assessed it. */
  assessedOn: string | null
  /** Effective date: when payment was due. */
  paymentDue: string | null
  /** What of it is unpaid at the balance date (oldest debts paid first). */
  unpaid: number
  /** Days past the payment due date at the balance date, while any is unpaid; null when paid or not yet due. */
  daysUnpaidPastDue: number | null
}

export interface IncomeTaxSummary {
  assessments: IncomeTaxAssessment[]
  assessedTotal: number
  gic: { charged: number; remitted: number; net: number }
  payments: AtoAccountCore['payments']
  note: string
}

export const INCOME_TAX_DPN_NOTE = "Company income tax isn't covered by director penalty notices."

const round2 = (n: number) => Math.round(n * 100) / 100
const DAY = 86_400_000
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY)

/** What of each charge is unpaid: the balance spread over the newest charges first. */
export function unpaidByRow(rows: readonly AccountRow[], balance: number | null): Map<number, number> {
  const unpaid = new Map<number, number>()
  let left = Math.max(0, balance ?? 0)
  const charges = rows
    .filter((r) => r.line && r.line !== 'payments' && r.line !== 'otherCredits' && (r.debit ?? 0) > 0)
    .sort((a, b) => {
      const da = (a.effectiveDate ?? a.processedDate)?.getTime() ?? 0
      const db = (b.effectiveDate ?? b.processedDate)?.getTime() ?? 0
      return db - da || a.rowIndex - b.rowIndex
    })
  for (const r of charges) {
    if (left <= 0) break
    const part = Math.min(r.debit ?? 0, left)
    unpaid.set(r.rowIndex, round2(part))
    left = round2(left - part)
  }
  return unpaid
}

export function incomeTaxSummary(core: AtoAccountCore): IncomeTaxSummary {
  const unpaid = unpaidByRow(core.rows, core.balance)
  const assessments = core.rows
    .filter((r) => r.line === 'assessments')
    .map((r): IncomeTaxAssessment => {
      const paymentDue = calendarDay(r.effectiveDate)
      const owing = unpaid.get(r.rowIndex) ?? 0
      const days = owing > 0 && paymentDue && core.balanceDate ? daysBetween(paymentDue, core.balanceDate) : null
      return {
        rowIndex: r.rowIndex,
        period: periodOf(r.description),
        description: r.description,
        amount: round2((r.debit ?? 0) - (r.credit ?? 0)),
        assessedOn: calendarDay(r.processedDate),
        paymentDue,
        unpaid: owing,
        daysUnpaidPastDue: days !== null && days > 0 ? days : null,
      }
    })
    .sort((a, b) => (a.paymentDue ?? '').localeCompare(b.paymentDue ?? ''))

  const gic = core.totals.interest ?? { debits: 0, credits: 0, net: 0 }
  return {
    assessments,
    assessedTotal: round2(assessments.reduce((s, a) => s + a.amount, 0)),
    gic: { charged: gic.debits, remitted: gic.credits, net: gic.net },
    payments: core.payments,
    note: INCOME_TAX_DPN_NOTE,
  }
}

/** "unpaid 139 days past the payment due date". */
export function unpaidPhrase(a: Pick<IncomeTaxAssessment, 'daysUnpaidPastDue'>): string | null {
  return a.daysUnpaidPastDue ? `unpaid ${a.daysUnpaidPastDue} day${a.daysUnpaidPastDue === 1 ? '' : 's'} past the payment due date` : null
}
