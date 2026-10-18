import type { DpnSummary } from './summary'
import { DPN_TYPE_LABEL, type DpnType } from './types'

/**
 * The director penalty notices' own figures, in dollars, for the lodgement
 * report's DPN panel and its AI summary: the company's current notices,
 * each type + period counted once (summary.ts). Null when no notice on file
 * has figures, and the report falls back to its estimate from the ATO account.
 *
 *   unpaid             column 3: unpaid amount
 *   removable          column 4: removed if an SBR practitioner, administrator
 *                      or liquidator is appointed, or it is paid, by the deadline
 *   staysWithDirector  column 5: stays with the director unless paid
 */
export interface DpnNoticeFigures {
  unpaid: number
  removable: number
  staysWithDirector: number
  /** The earliest deadline among the current notices (ISO). */
  deadline: string
  /** Whole days from today to it; negative once passed. */
  daysLeft: number
  /** The latest issue date among the current notices (ISO). */
  issuedOn: string
  byType: { type: DpnType; label: string; unpaid: number; removable: number; staysWithDirector: number; deadline: string }[]
  notices: number
}

const dollars = (cents: number) => Math.round(cents) / 100

export function dpnNoticeFigures(summary: DpnSummary): DpnNoticeFigures | null {
  const current = summary.notices.filter((n) => n.standing === 'current')
  if (summary.companyByType.length === 0 || current.length === 0) return null
  const deadline = [...current.map((n) => n.deadline)].sort()[0]
  const soonest = current.find((n) => n.deadline === deadline)!
  return {
    unpaid: dollars(summary.company.column3),
    removable: dollars(summary.company.column4),
    staysWithDirector: dollars(summary.company.column5),
    deadline,
    daysLeft: soonest.daysLeft,
    issuedOn: [...current.map((n) => n.issuedOn)].sort().at(-1)!,
    byType: summary.companyByType.map((t) => ({
      type: t.type,
      label: DPN_TYPE_LABEL[t.type],
      unpaid: dollars(t.totals.column3),
      removable: dollars(t.totals.column4),
      staysWithDirector: dollars(t.totals.column5),
      deadline: t.earliestDeadline,
    })),
    notices: current.length,
  }
}
