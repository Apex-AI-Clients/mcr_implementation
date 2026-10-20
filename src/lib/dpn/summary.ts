import { daysUntil, directorNameMatches } from './checks'
import { sumRows } from './parse'
import type { NoticeSource } from './stored'
import { DPN_TYPE_LABEL, type DpnAmounts, type DpnRow, type DpnType } from './types'
import type { DpnNoticeView } from './view'

/**
 * A client's director penalty notices, summarised for the DPN page and its
 * CSV and PDF exports. Pure, so the three can never disagree.
 *
 * Rules (Gabby's call, 17 Oct 2026):
 *  - Current and history: for each director and type, the most recently
 *    issued notice is current; earlier ones are history. Totals use current
 *    notices only.
 *  - Several directors each receive their own notice for the same company
 *    debt. Per-director totals count each director's own current notices; the
 *    company total counts each type + period once, taking the figures from the
 *    more recently issued notice.
 *  - A notice still waiting for manual entry (or never read) has no figures
 *    to count. It is listed, apart, and is in no total.
 *
 * The figures are the notices' own; the labels follow the notices' wording.
 * Nothing here is advice.
 */

export type Standing = 'current' | 'history'

export interface SummaryNotice {
  documentId: string
  filename: string
  type: DpnType
  directorName: string
  reference: string | null
  issuedOn: string
  /** Issue date + 21 days. */
  deadline: string
  /** Whole days from today to the deadline; negative once passed. */
  daysLeft: number
  source: NoticeSource
  /** 'needs_review': complete, but something must be checked (issues). */
  needsReview: boolean
  issues: string[]
  rows: DpnRow[]
  totals: DpnAmounts
  standing: Standing
}

export interface WaitingNotice {
  documentId: string
  filename: string
}

export interface TypeTotals {
  type: DpnType
  totals: DpnAmounts
  /** The earliest deadline among this type's current notices. */
  earliestDeadline: string
  /** Distinct periods counted, after de-duplication. */
  periods: number
}

export interface DirectorTotals {
  directorName: string
  byType: { type: DpnType; totals: DpnAmounts; deadline: string }[]
  overall: DpnAmounts
}

export interface DpnSummary {
  /** Current first, then history; each newest first. */
  notices: SummaryNotice[]
  waiting: WaitingNotice[]
  /** The company's debt by type, each type + period counted once. */
  companyByType: TypeTotals[]
  /** All types together, de-duplicated. */
  company: DpnAmounts
  directors: DirectorTotals[]
}

const TYPE_ORDER: DpnType[] = ['paygw', 'gst', 'sgc']
const ZERO: DpnAmounts = { column2: 0, column3: 0, column4: 0, column5: 0 }

function add(a: DpnAmounts, b: DpnAmounts): DpnAmounts {
  return {
    column2: a.column2 + b.column2,
    column3: a.column3 + b.column3,
    column4: a.column4 + b.column4,
    column5: a.column5 + b.column5,
  }
}

/** Newest first; a tie on the date falls back to the reference, so the order is stable. */
function newestFirst(a: Pick<SummaryNotice, 'issuedOn' | 'reference'>, b: Pick<SummaryNotice, 'issuedOn' | 'reference'>) {
  return b.issuedOn.localeCompare(a.issuedOn) || (b.reference ?? '').localeCompare(a.reference ?? '')
}

export function summariseNotices(views: readonly DpnNoticeView[], todayIso: string): DpnSummary {
  const complete: Omit<SummaryNotice, 'standing'>[] = []
  const waiting: WaitingNotice[] = []

  for (const view of views) {
    const n = view.notice
    if (
      !n ||
      n.status === 'needs_manual' ||
      !n.type ||
      !n.issuedOn ||
      !n.directorName ||
      !view.deadline ||
      n.rows.length === 0
    ) {
      waiting.push({ documentId: view.documentId, filename: view.filename })
      continue
    }
    complete.push({
      documentId: view.documentId,
      filename: view.filename,
      type: n.type,
      directorName: n.directorName,
      reference: n.reference,
      issuedOn: n.issuedOn,
      deadline: view.deadline,
      daysLeft: daysUntil(view.deadline, todayIso),
      source: n.source,
      needsReview: n.status === 'needs_review',
      issues: view.issues,
      rows: n.rows,
      totals: n.totals ?? sumRows(n.rows),
    })
  }

  // Directors: the same person may be printed "MR JANE Q SAMPLE" on one
  // notice and "MS J SAMPLE" on another, so group by name match, not text.
  const groups: { name: string; notices: Omit<SummaryNotice, 'standing'>[] }[] = []
  for (const notice of [...complete].sort(newestFirst)) {
    const group = groups.find((g) => directorNameMatches(g.name, notice.directorName))
    if (group) group.notices.push(notice)
    else groups.push({ name: notice.directorName, notices: [notice] })
  }

  const notices: SummaryNotice[] = []
  const directors: DirectorTotals[] = []
  for (const group of groups) {
    const byType: DirectorTotals['byType'] = []
    for (const type of TYPE_ORDER) {
      // Newest first already, so the first of each type is current.
      const ofType = group.notices.filter((n) => n.type === type)
      ofType.forEach((n, i) => notices.push({ ...n, standing: i === 0 ? 'current' : 'history' }))
      if (ofType[0]) byType.push({ type, totals: ofType[0].totals, deadline: ofType[0].deadline })
    }
    directors.push({
      directorName: group.name,
      byType,
      overall: byType.reduce((sum, t) => add(sum, t.totals), ZERO),
    })
  }
  notices.sort(
    (a, b) => (a.standing === b.standing ? newestFirst(a, b) : a.standing === 'current' ? -1 : 1),
  )

  // Company: each type + period once, from the most recently issued notice.
  const current = notices.filter((n) => n.standing === 'current')
  const byPeriod = new Map<string, { type: DpnType; row: DpnRow }>()
  for (const notice of [...current].sort(newestFirst)) {
    for (const row of notice.rows) {
      const key = `${notice.type}|${row.periodFrom}|${row.periodTo}`
      if (!byPeriod.has(key)) byPeriod.set(key, { type: notice.type, row })
    }
  }
  const companyByType: TypeTotals[] = []
  for (const type of TYPE_ORDER) {
    const rows = [...byPeriod.values()].filter((p) => p.type === type).map((p) => p.row)
    if (rows.length === 0) continue
    const deadlines = current.filter((n) => n.type === type).map((n) => n.deadline).sort()
    companyByType.push({ type, totals: sumRows(rows), earliestDeadline: deadlines[0], periods: rows.length })
  }

  return {
    notices,
    waiting,
    companyByType,
    company: companyByType.reduce((sum, t) => add(sum, t.totals), ZERO),
    directors,
  }
}

const SHORT_DATE = new Intl.DateTimeFormat('en-AU', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})

/** "2026-10-21" -> "21 Oct 2026". ISO dates here are calendar dates, not instants. */
export function formatIsoDate(iso: string): string {
  return SHORT_DATE.format(new Date(`${iso}T00:00:00Z`))
}

/**
 * Each table column's heading as the ATO prints it: the second header row,
 * under "Column 1" … "Column 5". Read from PAYG withholding and GST notices;
 * Columns 3–5 are worded the same on both. This is statutory form wording, so
 * it is held here rather than read from each PDF (whose text layer runs
 * neighbouring headings together).
 */
const COMMON_HEADINGS = {
  column3: "Amount the Commissioner thinks is the unpaid amount of the company's liability",
  column4: "Unpaid amount of the company's liability notified on or before the end of 3 months after the due day",
  column5: "Unpaid amount of the company's liability not notified on or before the end of 3 months after the due day",
} as const

const TYPE_HEADINGS: Record<'paygw' | 'gst', { column1: string; column2: string }> = {
  paygw: { column1: 'Particular withholding period', column2: 'Amount withheld' },
  gst: { column1: 'Particular period', column2: 'Net amount from the latest Business Activity Statement' },
}

export type DpnColumn = 'column1' | keyof DpnAmounts

/**
 * A column's heading for notices of these types. Columns 1 and 2 differ by
 * type: one type gives its own heading; a mix gives both, "withheld / net
 * amount"; a type whose wording is not known (super guarantee) gives a plain
 * description.
 */
export function columnHeading(column: DpnColumn, types: readonly (DpnType | null)[]): string {
  if (column !== 'column1' && column !== 'column2') return COMMON_HEADINGS[column]
  const known = [...new Set(types)]
  const headings = known.map((t) => (t === 'paygw' || t === 'gst' ? TYPE_HEADINGS[t][column] : null))
  if (headings.length > 0 && headings.every((h) => h !== null)) return headings.join(' / ')
  return column === 'column1' ? 'Period' : 'Amount on the notice'
}

/** Columns 2–5's headings, for a table of notices of these types. */
export function amountHeadings(types: readonly (DpnType | null)[]): Record<keyof DpnAmounts, string> {
  return {
    column2: columnHeading('column2', types),
    column3: columnHeading('column3', types),
    column4: columnHeading('column4', types),
    column5: columnHeading('column5', types),
  }
}

/** Under the notices table, on the page and in the PDF: what the columns mean for an SBR. */
export const DPN_TABLE_LEGEND = [
  "Notified on or before the end of 3 months: removed if the company appoints an SBR practitioner, administrator or liquidator, or pays, by the notice's deadline.",
  'Not notified on or before the end of 3 months: stays with the director unless paid.',
  '"Current" is the most recent notice for that director and type; totals use current notices.',
]

/**
 * The columns in plain English, after the notices' own wording. Column 4's
 * label carries the deadline that applies to it.
 */
export function columnLabels(type: DpnType | null, deadline: string | null): Record<keyof DpnAmounts, string> {
  return {
    column2: columnHeading('column2', [type]),
    column3: 'Unpaid',
    column4: `Removed if the company appoints an SBR practitioner, administrator or liquidator, or pays, by ${
      deadline ? formatIsoDate(deadline) : 'the deadline'
    }`,
    column5: 'Stays with the director unless paid',
  }
}

export function typeLabel(type: DpnType): string {
  return DPN_TYPE_LABEL[type]
}

/** "4 days left", "1 day left", "Due today", "Passed 2 days ago". */
export function describeDaysLeft(days: number): string {
  if (days > 1) return `${days} days left`
  if (days === 1) return '1 day left'
  if (days === 0) return 'Due today'
  return days === -1 ? 'Passed 1 day ago' : `Passed ${-days} days ago`
}

/** At or inside a week, or passed: shown in red. */
export function isUrgent(days: number): boolean {
  return days <= 7
}

/** The line every export carries. */
export const DPN_EXPORT_SOURCE_NOTE =
  'Figures come from ATO director penalty notices supplied by the client, read automatically or entered manually as marked.'
