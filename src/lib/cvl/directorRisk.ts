import type { EnrichedRow } from '@/lib/analysis/types'
import type { SuperGuaranteeSummary } from '@/lib/analysis/atoAccount/superGuarantee'
import type { DpnSummary } from '@/lib/dpn/summary'
import type { DpnType } from '@/lib/dpn/types'
import type { MappedLine } from '@/lib/printed/mapping'

/**
 * The director's personal risk, for a CVL file (Stage 5). Pure, rule-based,
 * over what the app has already read: no new extraction, no AI.
 *
 *   Issued DPNs       the notices on file (dpn/summary.ts): per director and
 *                     type, what is removed if acted on by the deadline and
 *                     what stays with the director
 *   Potential DPNs    PAYG withholding and GST from the activity statement's
 *                     own sub-lines, and the superannuation guarantee charge
 *                     from its account, each split by when it was reported:
 *                     within 3 months of its due date, or later (or never)
 *   Director loan     the confirmed loan account lines, year by year
 *   ATO debt          every ATO account's newest balance, together
 *
 * "Reported within 3 months" uses the same line as the DPN estimate on the
 * lodgement report: more than 90 days after the due date is late. Amounts are
 * what was reported; a notice can only cover what is still unpaid.
 */

export const REPORTED_LATE_DAYS = 90

export type PotentialType = DpnType

export interface ReportedItem {
  /** "Quarter ending 31 Dec 2025", "SG quarter 1 Oct 2025 – 31 Dec 2025". */
  period: string
  amount: number
  /** When it was reported: the statement's processed date (ISO), null when the company never reported it. */
  reportedOn: string | null
  /** Its due date (ISO), when known. */
  dueOn: string | null
  daysLate: number | null
  /** "Original activity statement", "Client amendment", "SGC statement", "ATO default assessment". */
  how: string
  late: boolean
}

export interface PotentialByType {
  type: PotentialType
  onTime: number
  late: number
  items: ReportedItem[]
}

export interface LoanYear {
  /** "FY2025", or the current period. */
  label: string
  receivable: number | null
  payable: number | null
  receivableLines: MappedLine[]
  payableLines: MappedLine[]
}

const round = (n: number) => Math.round(n * 100) / 100
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null)
const ddmmyyyy = (isoDate: string) => isoDate.split('-').reverse().join('/')

/* ---------------- PAYG withholding and GST ---------------- */

/** The tax a sub-line ("- GST", "- PAYG Withholding") is for; null for one a DPN cannot cover. */
export function subLineType(description: string): Extract<DpnType, 'paygw' | 'gst'> | null {
  const s = description.replace(/^'/, '').replace(/^-\s*/, '').trim().toLowerCase()
  if (/^payg withholding\b/.test(s)) return 'paygw'
  // GST, and the taxes reported and collected with it (wine equalisation, luxury car).
  if (/^(gst|goods and services tax|wine equalisation|luxury car)\b/.test(s)) return 'gst'
  return null
}

/**
 * Each activity statement's PAYG withholding and GST, from the sub-lines under
 * it, and whether it was reported more than 90 days after its due date.
 * Originals and client amendments both report an amount (an amendment reports
 * the change, when it was lodged).
 */
export function activityStatementExposure(rows: readonly EnrichedRow[]): PotentialByType[] {
  const items: Record<'paygw' | 'gst', ReportedItem[]> = { paygw: [], gst: [] }
  for (let i = 0; i < rows.length; i++) {
    const head = rows[i]
    if (head.lodgementType !== 'Original' && head.lodgementType !== 'ClientAmended') continue
    const byType = new Map<'paygw' | 'gst', number>()
    for (let j = i + 1; j < rows.length && rows[j].lodgementType === 'SubLine'; j++) {
      const type = subLineType(rows[j].description)
      if (!type) continue
      byType.set(type, (byType.get(type) ?? 0) + (rows[j].debit ?? 0) - (rows[j].credit ?? 0))
    }
    const daysLate = head.lateLodgementDays
    for (const [type, amount] of byType) {
      if (round(amount) <= 0) continue
      items[type].push({
        period: head.periodEnding ? `Period ending ${ddmmyyyy(iso(head.periodEnding)!)}` : head.description.replace(/^'/, ''),
        amount: round(amount),
        reportedOn: iso(head.processedDate),
        dueOn: iso(head.effectiveDate),
        daysLate,
        how: head.lodgementType === 'Original' ? 'Original activity statement' : 'Client amendment',
        late: daysLate > REPORTED_LATE_DAYS,
      })
    }
  }
  return (['paygw', 'gst'] as const).map((type) => totals(type, items[type]))
}

/* ---------------- Superannuation guarantee charge ---------------- */

/**
 * An SGC statement's due date: the 28th of the second month after the
 * quarter ends (28 Nov, 28 Feb, 28 May, 28 Aug).
 */
export function sgcDueDate(quarterEnd: string): string {
  const [y, m] = quarterEnd.split('-').map(Number)
  const due = new Date(Date.UTC(y, m - 1 + 2, 28))
  return due.toISOString().slice(0, 10)
}

const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000)

/**
 * Each quarter's charge, and whether the company reported it (its own SGC
 * statement) within 3 months of the statement's due date. A quarter only the
 * ATO raised (default assessment, audit) was never reported by the company.
 */
export function sgcExposure(summaries: readonly SuperGuaranteeSummary[]): PotentialByType {
  const items: ReportedItem[] = []
  for (const summary of summaries) {
    for (const q of summary.quarters) {
      if (round(q.total) <= 0) continue
      const own = q.events
        .filter((e) => e.kind === 'statement' || e.kind === 'client_amendment')
        .map((e) => e.processed)
        .filter((d): d is string => !!d)
        .sort()[0]
      const dueOn = sgcDueDate(q.period.to)
      const daysLate = own ? daysBetween(dueOn, own.slice(0, 10)) : null
      items.push({
        period: `SG quarter ${ddmmyyyy(q.period.from)} – ${ddmmyyyy(q.period.to)}`,
        amount: round(q.total),
        reportedOn: own ? own.slice(0, 10) : null,
        dueOn,
        daysLate,
        how: own ? 'SGC statement' : (q.headline?.label ?? 'Raised by the ATO'),
        late: daysLate === null || daysLate > REPORTED_LATE_DAYS,
      })
    }
  }
  return totals('sgc', items)
}

function totals(type: PotentialType, items: ReportedItem[]): PotentialByType {
  return {
    type,
    onTime: round(items.filter((i) => !i.late).reduce((s, i) => s + i.amount, 0)),
    late: round(items.filter((i) => i.late).reduce((s, i) => s + i.amount, 0)),
    items,
  }
}

/* ---------------- Issued notices ---------------- */

export interface IssuedByDirector {
  directorName: string
  /** Removed if the company appoints a liquidator (or pays) by the deadline. */
  removable: number
  /** Stays with the director unless paid. */
  stays: number
  /** The earliest deadline among this director's current notices. */
  deadline: string | null
  daysLeft: number | null
  types: DpnType[]
}

/** The notices on file, per director: what goes with liquidation by the deadline, and what stays. Cents in, dollars out. */
export function issuedByDirector(summary: DpnSummary): IssuedByDirector[] {
  const current = summary.notices.filter((n) => n.standing === 'current')
  return summary.directors.map((d) => {
    const mine = current.filter((n) => n.directorName === d.directorName)
    const next = mine.map((n) => ({ deadline: n.deadline, daysLeft: n.daysLeft })).sort((a, b) => a.deadline.localeCompare(b.deadline))[0]
    return {
      directorName: d.directorName,
      removable: round(d.overall.column4 / 100),
      stays: round(d.overall.column5 / 100),
      deadline: next?.deadline ?? null,
      daysLeft: next?.daysLeft ?? null,
      types: d.byType.map((t) => t.type),
    }
  })
}

/* ---------------- Director loan, year by year ---------------- */

/**
 * The confirmed loan account lines in every balance-sheet column that prints
 * one: owed to the company by the director (or related parties), and owed by
 * the company to them, oldest first. A year with neither is left out.
 */
export function directorLoanHistory(
  resolve: (meaning: 'loan_receivable' | 'loan_payable') => { status: string; years: { column: { key: string; kind: string; periodEnd: string }; value: number | null; lines: MappedLine[] }[] },
): LoanYear[] {
  const receivable = resolve('loan_receivable')
  const payable = resolve('loan_payable')
  const years = receivable.years.length ? receivable.years : payable.years
  return years
    .map((y, i) => {
      const r = receivable.status === 'mapped' ? receivable.years[i] : undefined
      const p = payable.status === 'mapped' ? payable.years[i] : undefined
      return {
        label: y.column.kind === 'annual' ? y.column.key : `At ${ddmmyyyy(y.column.periodEnd)}`,
        receivable: r?.value === null || r?.value === undefined ? null : round(r.value),
        payable: p?.value === null || p?.value === undefined ? null : round(p.value),
        receivableLines: r?.lines ?? [],
        payableLines: p?.lines ?? [],
      }
    })
    .filter((y) => y.receivable !== null || y.payable !== null)
}
