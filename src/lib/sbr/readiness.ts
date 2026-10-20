import type { FinancialFileRow } from '@/lib/financials/financialFiles'
import type { DpnNoticeView } from '@/lib/dpn/view'
import { noticeTypeLabel } from '@/lib/dpn/stored'

/**
 * Whether a client is ready for an SBR outcome prediction: three items, each
 * Not uploaded / Not run yet / Processing / Ready / Failed. Pure; one rule for
 * the checklist, the Predict button, the prediction page and the predict API.
 *
 * "Predict SBR outcome" opens once every item has finished: Ready, or Failed
 * (the work ran and could not produce a result, which no amount of waiting
 * changes). There is no review step: staff asked for the checklist to report
 * status only, not hand them things to sign off.
 */

export type ReadinessKey = 'financials' | 'lodgement' | 'dpn'
/**
 * 'processing' only while a run is actually going. 'not_started': there is
 * work to do (files never read, a comparison out of date) and nothing is
 * running — offered as "Run now".
 */
export type ReadinessStatus = 'not_uploaded' | 'not_started' | 'processing' | 'ready' | 'failed'

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
  failed: 'Failed',
}

export interface ReadinessItem {
  key: ReadinessKey
  label: string
  status: ReadinessStatus
  /** One line: what this item is waiting for, or what it found. Null: the status says it all. */
  detail: string | null
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
    comparison: { generatedAt: string; staleSince: string | null } | null
    /** Files never read (or overridden since), or a comparison out of date. */
    outOfDate: boolean
  }
  lodgement: {
    /** CSVs uploaded under the integrated client account. */
    csvCount: number
    analysis: { id: string; analysedAt: string } | null
    /** An activity statement export not yet analysed. */
    outOfDate: boolean
    /** CSVs are uploaded, but none of them is an activity statement export. */
    noExportFound: boolean
  }
  dpn: {
    notices: DpnNoticeView[]
    noneIssued: { by: string; at: string } | null
  }
}

export interface Readiness {
  items: ReadinessItem[]
  /** Every item finished: Ready or Failed (DPNs may also be not uploaded). */
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

function item(input: ReadinessInput, key: ReadinessKey, status: ReadinessStatus, detail: string | null, href: string): ReadinessItem {
  return {
    key,
    label: READINESS_LABEL[key],
    status,
    detail,
    // Run now belongs to work that is waiting, never to work under way.
    canRunNow: status === 'not_started' && !input.jobRunning,
    href,
  }
}

/**
 * No line under the heading: the badge carries it. The per-year notes that
 * used to sit here ("Compared, with 1 thing to check") read as a to-do list,
 * and the comparison page already shows every gap in place.
 */
function financialsItem(input: ReadinessInput): ReadinessItem {
  const f = input.financials
  const href = `/clients/${input.clientId}/financials-comparison`
  if (f.files.length === 0) return item(input, 'financials', 'not_uploaded', null, `/clients/${input.clientId}`)
  if (input.jobRunning) return item(input, 'financials', 'processing', null, href)
  if (f.outOfDate) return item(input, 'financials', 'not_started', null, href)
  // Read, but fewer than two annual statements came out: nothing to compare.
  if (!f.comparison) return item(input, 'financials', 'failed', null, href)
  return item(input, 'financials', 'ready', null, href)
}

function lodgementItem(input: ReadinessInput): ReadinessItem {
  const l = input.lodgement
  const href = `/clients/${input.clientId}/lodgement-compliance-analysis`
  if (l.csvCount === 0) {
    return item(input, 'lodgement', 'not_uploaded', 'Upload the ATO activity statement account CSV.', `/clients/${input.clientId}`)
  }
  if (input.jobRunning && (l.outOfDate || !l.analysis)) {
    return item(input, 'lodgement', 'processing', 'Being analysed now.', href)
  }
  if (l.outOfDate) return item(input, 'lodgement', 'not_started', 'The export has not been analysed yet.', href)
  if (!l.analysis) {
    return item(
      input,
      'lodgement',
      'not_uploaded',
      l.noExportFound
        ? 'None of the uploaded CSVs is an activity statement account export.'
        : 'Upload the ATO activity statement account CSV.',
      `/clients/${input.clientId}`,
    )
  }
  // No summary under the heading: the figures are on the lodgement analysis.
  return item(input, 'lodgement', 'ready', null, href)
}

function dpnItem(input: ReadinessInput): ReadinessItem {
  const d = input.dpn
  const href = `/clients/${input.clientId}/director-penalty-notices`
  if (d.notices.length === 0) {
    return d.noneIssued
      ? item(
          input,
          'dpn',
          'ready',
          `No director penalty notice has been issued (ticked by ${d.noneIssued.by}, ${shortDate(d.noneIssued.at)}).`,
          `/clients/${input.clientId}`,
        )
      : item(
          input,
          'dpn',
          'not_uploaded',
          'Optional. Upload the notices, or tick "No director penalty notice has been issued"; otherwise answer Yes or No on the prediction page.',
          `/clients/${input.clientId}`,
        )
  }

  // Read means its details came out, whatever the notices page then flags
  // about them (a different ACN, say): that is shown there, not here.
  const read = d.notices.filter((v) => v.notice && v.notice.status !== 'needs_manual')
  if (read.length > 0) {
    const types = [...new Set(read.map((v) => noticeTypeLabel(v.notice!) ?? 'notice'))].join(' and ')
    return item(input, 'dpn', 'ready', `${read.length} notice${read.length === 1 ? '' : 's'} read (${types}).`, href)
  }
  if (d.notices.some((v) => !v.notice)) {
    return input.jobRunning
      ? item(input, 'dpn', 'processing', 'Being read now.', href)
      : item(input, 'dpn', 'not_started', 'Not read yet.', href)
  }
  return item(input, 'dpn', 'failed', 'Could not be read. Enter the details on the notices page.', href)
}

/** Finished, one way or the other: waiting longer would not change it. */
function settled(i: ReadinessItem): boolean {
  return i.status === 'ready' || i.status === 'failed'
}

/**
 * Director penalty notices are optional: with none uploaded and "none
 * issued" not ticked, Predict still runs and staff answer the DPN question on
 * the prediction page. Notices that ARE uploaded must be read first.
 */
function optional(i: ReadinessItem): boolean {
  return i.key === 'dpn' && i.status === 'not_uploaded'
}

export function computeReadiness(input: ReadinessInput): Readiness {
  const items = [financialsItem(input), lodgementItem(input), dpnItem(input)]
  return {
    items,
    canPredict: items.every((i) => settled(i) || optional(i)),
    waitingFor: items
      .filter((i) => !settled(i) && !optional(i))
      .map((i) => `${i.label}: ${STATUS_LABEL[i.status].toLowerCase()}`),
    // Yes if any notice is on file; No if staff ticked "none issued"; null
    // otherwise, and staff answer on the prediction page.
    dpn: input.dpn.notices.length > 0 ? true : input.dpn.noneIssued ? false : null,
  }
}
