import type { DpnRiskBreakdown } from './types'

/**
 * The DPN estimate's workings in plain English (computeDpnRisk), shared by the
 * lodgement report, its CSV export and the summary prompt. No parser import:
 * the report card is a client component.
 *
 * Null for an estimate stored before 16 Nov 2026 (no window: payments were
 * not counted then).
 */
export function dpnEstimateWorkings(d: DpnRiskBreakdown): string[] | null {
  const w = d.window
  if (d.method !== 'payments_oldest_first' || !w) return null
  const lines: string[] = []

  const since = w.start
    ? `Since the balance was last ${(w.startBalance ?? 0) < 0 ? 'in credit' : 'nil'} (${day(w.start)})`
    : `The balance was never nil in this ATO account export. From its first row (opening owing ${money(w.openingDebt)}, treated as the oldest debt)`
  lines.push(
    `${since}: ${money(d.totalGrossLate)} lodged more than 90 days late; ${money(w.payments)} paid since` +
      (w.startingCredit > 0 ? `, plus the ${money(w.startingCredit)} credit held then.` : '.'),
  )
  if (d.totalReducedByAmendments > 0) {
    lines.push(`Later amendments for the same periods reduced the late-lodged debt by ${money(d.totalReducedByAmendments)}.`)
  }
  if (d.totalGrossLate <= 0) {
    lines.push('No debt was lodged more than 90 days late in that time.')
  } else if (d.totalNetAtRisk <= 0) {
    lines.push('If the ATO applied payments to the oldest debts first, the late-lodged debt has been paid.')
  } else {
    lines.push(
      `If the ATO applied payments to the oldest debts first, ${money(d.totalNetAtRisk)} of the late-lodged debt is still unpaid` +
        (w.otherTaxDebtsPaid > 0 ? `; ${money(w.otherTaxDebtsPaid)} went first to other tax debts that fell due earlier.` : '.'),
    )
  }
  const before = round2(w.grossLateAllHistory - d.totalGrossLate)
  if (before > 0) lines.push(`${money(before)} lodged more than 90 days late before then is treated as paid.`)
  if (w.startUnder1000) {
    lines.push(`For information: the balance was last $1,000 or less on ${day(w.startUnder1000)}${w.startUnder1000 === w.start ? ' (the same day)' : ''}.`)
  }
  lines.push('This is an estimate from the ATO account, not the ATO’s notice.')
  return lines
}

const round2 = (n: number) => Math.round(n * 100) / 100

function money(n: number): string {
  return `$${Math.round(n).toLocaleString('en-AU')}`
}

function day(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}
