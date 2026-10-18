import type { StatementCoverage } from '@/lib/financials/coverage'
import type { FinancialFileRow } from '@/lib/financials/financialFiles'
import type { DpnNoticeView } from '@/lib/dpn/view'
import { noticeTypeLabel } from '@/lib/dpn/stored'

/**
 * Whether a client is ready for an SBR outcome prediction: three items, each
 * Not uploaded / Processing / Ready / Needs review. Pure; one rule for the
 * checklist, the Predict button, the prediction page and the predict API.
 *
 * "Predict SBR outcome" opens only when every item is Ready, or Needs review
 * and has been reviewed. A review counts only while what was reviewed is
 * unchanged (its fingerprint): new data needs a new review.
 */

export type ReadinessKey = 'financials' | 'lodgement' | 'dpn'
/**
 * 'processing' only while a run is actually going. 'not_started': there is
 * work to do (files never read, a comparison out of date) and nothing is
 * running — offered as "Run now".
 */
export type ReadinessStatus = 'not_uploaded' | 'not_started' | 'processing' | 'ready' | 'needs_review'

export const READINESS_LABEL: Record<ReadinessKey, string> = {
  financials: 'Financial statements',
  lodgement: 'ATO activity statement',
  dpn: 'Director penalty notices',
}

export const STATUS_LABEL: Record<ReadinessStatus, string> = {
  not_uploaded: 'Not uploaded',
  not_started: 'Not run yet',
  processing: 'Processing',
  ready: 'Ready',
  needs_review: 'Needs review',
}

export interface Review {
  fingerprint: string
  by: string
  at: string
}

export interface ReadinessItem {
  key: ReadinessKey
  label: string
  status: ReadinessStatus
  /** One line: what this item is waiting for, or what it found. */
  detail: string
  /** What needs looking at, one per line. */
  notes: string[]
  /** Identifies what a review would cover. Null when there is nothing to review. */
  fingerprint: string | null
  /** The review of exactly what is there now, if any. */
  review: Review | null
  /** Not run yet ('not_started'): offer to start the run. Never while one is going. */
  canRunNow: boolean
  /** Where to look. */
  href: string
}

export interface ReadinessInput {
  clientId: string
  /** An analysis run (automatic or from the comparison page) is going now. */
  jobRunning: boolean
  financials: {
    files: FinancialFileRow[]
    coverage: StatementCoverage
    comparison: { generatedAt: string; staleSince: string | null } | null
    /** Files never read (or overridden since), or a comparison out of date. */
    outOfDate: boolean
  }
  lodgement: {
    /** CSVs uploaded under the integrated client account. */
    csvCount: number
    analysis: { id: string; analysedAt: string; warnings: number; late: number; daysLate: number } | null
    /** An activity statement export not yet analysed. */
    outOfDate: boolean
    /** CSVs are uploaded, but none of them is an activity statement export. */
    noExportFound: boolean
  }
  dpn: {
    notices: DpnNoticeView[]
    noneIssued: { by: string; at: string } | null
  }
  reviews: Partial<Record<ReadinessKey, Review>>
}

export interface Readiness {
  items: ReadinessItem[]
  /** Every item Ready, or Needs review and reviewed. */
  canPredict: boolean
  /** For the disabled button: what it is waiting for, one per item. */
  waitingFor: string[]
  /** The prediction's DPN factor: never a default. Null until it is known. */
  dpn: boolean | null
}

const shortDate = (iso: string) =>
  new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Australia/Sydney' }).format(
    new Date(iso),
  )

function item(
  input: ReadinessInput,
  key: ReadinessKey,
  status: ReadinessStatus,
  detail: string,
  extra: { notes?: string[]; fingerprint?: string | null; href: string },
): ReadinessItem {
  const fingerprint = extra.fingerprint ?? null
  const stored = input.reviews[key]
  // Run now belongs to work that is waiting, never to work under way.
  const canRunNow = status === 'not_started' && !input.jobRunning
  return {
    key,
    label: READINESS_LABEL[key],
    status,
    detail,
    notes: extra.notes ?? [],
    fingerprint,
    review: stored && fingerprint !== null && stored.fingerprint === fingerprint ? stored : null,
    canRunNow,
    href: extra.href,
  }
}

function financialsItem(input: ReadinessInput): ReadinessItem {
  const f = input.financials
  const href = `/clients/${input.clientId}/financials-comparison`
  if (f.files.length === 0) {
    return item(input, 'financials', 'not_uploaded', 'Upload the Profit and Loss and Balance Sheet for the last 4 years and the current period.', { href: `/clients/${input.clientId}` })
  }
  if (input.jobRunning) {
    return item(input, 'financials', 'processing', 'Being read and compared now.', { href })
  }
  if (f.outOfDate) {
    return item(input, 'financials', 'not_started', 'New or changed files have not been read and compared yet.', { href })
  }

  const notes: string[] = []
  for (const file of f.files) {
    if (['nothing_read', 'not_financial', 'tax_return_only'].includes(file.usage)) {
      notes.push(`${file.filename}: ${file.note}`)
    }
  }
  if (f.comparison) {
    const halves = [
      ['income_statement', 'Profit and Loss'],
      ['balance_sheet', 'Balance Sheet'],
    ] as const
    // A full year between the newest annual statement and the current period
    // was never uploaded: one note for the year, not one per half.
    const notUploaded = f.coverage.columns.filter((c) => c.notUploaded).map((c) => c.financialYear)
    const latestMissing = notUploaded.length ? Math.max(...notUploaded) : null
    for (const year of notUploaded) {
      notes.push(
        `${year === latestMissing ? `Latest full year (FY${year}) missing` : `FY${year} missing`}: year ended 30 June ${year} not uploaded.`,
      )
    }
    f.coverage.columns.forEach((column, i) => {
      if (column.extra || column.notUploaded) return
      for (const [half, name] of halves) {
        const status = f.coverage.rows[half][i]?.status
        const where = column.kind === 'current_period' ? 'current period' : column.label
        if (status === 'missing') notes.push(`${where} ${name} is missing.`)
        if (status === 'failed') notes.push(`${where} ${name} could not be read.`)
      }
    })
    if (!f.coverage.columns.some((c) => c.kind === 'current_period')) notes.push('No current-period statement is on file.')
  }

  const fingerprint = `${f.comparison?.generatedAt ?? 'none'}|${f.files.map((x) => `${x.documentId}:${x.usage}`).sort().join(',')}`
  if (!f.comparison) {
    return item(input, 'financials', 'needs_review', 'Fewer than two annual statements could be read, so there is no comparison.', {
      notes,
      fingerprint,
      href,
    })
  }
  return notes.length > 0
    ? item(input, 'financials', 'needs_review', `Compared, with ${notes.length} thing${notes.length === 1 ? '' : 's'} to check.`, { notes, fingerprint, href })
    : item(input, 'financials', 'ready', 'Compared: every year and the current period are on file.', { fingerprint, href })
}

function lodgementItem(input: ReadinessInput): ReadinessItem {
  const l = input.lodgement
  const href = `/clients/${input.clientId}/lodgement-compliance-analysis`
  if (l.csvCount === 0) {
    return item(input, 'lodgement', 'not_uploaded', 'Upload the ATO activity statement account CSV.', { href: `/clients/${input.clientId}` })
  }
  if (input.jobRunning && (l.outOfDate || !l.analysis)) {
    return item(input, 'lodgement', 'processing', 'Being analysed now.', { href })
  }
  if (l.outOfDate) {
    return item(input, 'lodgement', 'not_started', 'The export has not been analysed yet.', { href })
  }
  if (!l.analysis) {
    return item(
      input,
      'lodgement',
      'not_uploaded',
      l.noExportFound
        ? 'None of the uploaded CSVs is an activity statement account export.'
        : 'Upload the ATO activity statement account CSV.',
      { href: `/clients/${input.clientId}` },
    )
  }
  const a = l.analysis
  const fingerprint = `${a.id}|${a.analysedAt}`
  const summary = `${a.late} late lodgement${a.late === 1 ? '' : 's'}, ${a.daysLate} days late in total.`
  return a.warnings > 0
    ? item(input, 'lodgement', 'needs_review', summary, {
        notes: [`The export raised ${a.warnings} warning${a.warnings === 1 ? '' : 's'}: see the lodgement analysis.`],
        fingerprint,
        href,
      })
    : item(input, 'lodgement', 'ready', summary, { fingerprint, href })
}

function dpnItem(input: ReadinessInput): ReadinessItem {
  const d = input.dpn
  const href = `/clients/${input.clientId}/director-penalty-notices`
  if (d.notices.length === 0) {
    return d.noneIssued
      ? item(input, 'dpn', 'ready', `No director penalty notice has been issued (ticked by ${d.noneIssued.by}, ${shortDate(d.noneIssued.at)}).`, {
          href: `/clients/${input.clientId}`,
        })
      : item(input, 'dpn', 'not_uploaded', 'Upload the notices, or tick "No director penalty notice has been issued".', {
          href: `/clients/${input.clientId}`,
        })
  }

  const clean = d.notices.filter((v) => v.notice?.status === 'read' && v.issues.length === 0)
  const unread = d.notices.filter((v) => !v.notice)
  const notes: string[] = []
  for (const v of d.notices) {
    if (!v.notice) notes.push(`${v.filename}: not read yet.`)
    else if (v.notice.status === 'needs_manual') notes.push(`${v.filename}: needs entering manually.`)
    else for (const issue of v.issues) notes.push(`${v.filename}: ${issue}`)
  }
  const fingerprint = d.notices
    .map((v) => `${v.documentId}:${v.notice?.status ?? 'unread'}:${v.notice?.enteredAt ?? ''}:${v.issues.length}`)
    .sort()
    .join(',')

  if (clean.length > 0) {
    const types = [...new Set(clean.map((v) => noticeTypeLabel(v.notice!) ?? 'notice'))].join(' and ')
    return item(input, 'dpn', 'ready', `${clean.length} notice${clean.length === 1 ? '' : 's'} read (${types}).`, {
      notes,
      fingerprint,
      href,
    })
  }
  if (unread.length > 0) {
    return input.jobRunning
      ? item(input, 'dpn', 'processing', 'Being read now.', { notes, href })
      : item(input, 'dpn', 'not_started', 'Not read yet.', { notes, href })
  }
  return item(input, 'dpn', 'needs_review', 'No notice has been read cleanly yet.', { notes, fingerprint, href })
}

function satisfied(i: ReadinessItem): boolean {
  return i.status === 'ready' || (i.status === 'needs_review' && i.review !== null)
}

export function computeReadiness(input: ReadinessInput): Readiness {
  const items = [financialsItem(input), lodgementItem(input), dpnItem(input)]
  return {
    items,
    canPredict: items.every(satisfied),
    waitingFor: items
      .filter((i) => !satisfied(i))
      .map((i) => `${i.label}: ${i.status === 'needs_review' ? 'needs review' : STATUS_LABEL[i.status].toLowerCase()}`),
    // Yes if any notice is on file; No only if staff ticked "none issued".
    dpn: input.dpn.notices.length > 0 ? true : input.dpn.noneIssued ? false : null,
  }
}
