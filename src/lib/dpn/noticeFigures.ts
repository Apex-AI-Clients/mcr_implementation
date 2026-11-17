import { columnLabels, type DpnSummary } from './summary'
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
  /** Each current notice, with its rows as printed (Columns 2–5, in dollars), newest first. */
  items: DpnNoticeItem[]
}

export interface DpnNoticeItem {
  documentId: string
  filename: string
  type: DpnType
  label: string
  reference: string | null
  issuedOn: string
  deadline: string
  daysLeft: number
  /** The notice's column headings (summary.ts columnLabels). */
  headings: Record<'column2' | 'column3' | 'column4' | 'column5', string>
  rows: { periodFrom: string; periodTo: string; column2: number; column3: number; column4: number; column5: number }[]
  totals: { column2: number; column3: number; column4: number; column5: number }
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
    items: current.map((n) => ({
      documentId: n.documentId,
      filename: n.filename,
      type: n.type,
      label: DPN_TYPE_LABEL[n.type],
      reference: n.reference,
      issuedOn: n.issuedOn,
      deadline: n.deadline,
      daysLeft: n.daysLeft,
      headings: columnLabels(n.type, n.deadline),
      rows: n.rows.map((r) => ({
        periodFrom: r.periodFrom,
        periodTo: r.periodTo,
        column2: dollars(r.column2),
        column3: dollars(r.column3),
        column4: dollars(r.column4),
        column5: dollars(r.column5),
      })),
      totals: { column2: dollars(n.totals.column2), column3: dollars(n.totals.column3), column4: dollars(n.totals.column4), column5: dollars(n.totals.column5) },
    })),
  }
}
