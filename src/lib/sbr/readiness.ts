import type { DpnNoticeView } from '@/lib/dpn/view'
import { noticeTypeLabel } from '@/lib/dpn/stored'
import { unparsedDatesMessage } from '@/lib/analysis/config'
import { TOTALS_HELD_BACK } from '@/lib/ica/status'
import { dateText } from '@/lib/dates'

/**
 * Whether a client is ready for an SBR outcome prediction: three items, each
 * Not uploaded / Not run yet / Processing / Ready / Failed. Pure; one rule for
 * the checklist, the Predict button, the prediction page and the predict API.
 *
 * "Predict SBR outcome" opens once every item has finished: Ready, or Failed
 * (the work ran and could not produce a result, which no amount of waiting
 * changes). One review step: financial statements whose comparison fails a
 * hard check (hardChecks.ts) are Needs review until a staff member ticks "I've
 * checked these figures against the source documents" on the comparison page
 * — the same tick that unlocks its PDF and CSV.
 */

export type ReadinessKey = 'financials' | 'lodgement' | 'dpn'
/**
 * 'processing' only while a run is actually going. 'not_started': there is
 * work to do (files never read, a comparison out of date) and nothing is
 * running — offered as "Run now". 'needs_files': what was uploaded is fine, but
 * more is needed (financial statements: only one year on file); shown in
 * amber, never as a fault, and it does not hold the prediction up.
 */
export type ReadinessStatus = 'not_uploaded' | 'not_started' | 'processing' | 'ready' | 'failed' | 'needs_review' | 'needs_files'

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
  needs_review: 'Needs review',
  needs_files: 'Needs more files',
}

export interface ReadinessItem {
  key: ReadinessKey
  label: string
  status: ReadinessStatus
  /** One line: what this item is waiting for, or what it found. Null: the status says it all. */
  detail: string | null
  /** Not run yet ('not_started'): offer to start the run. Never while one is going. */
  canRunNow: boolean
  /** Scanned statements are waiting to be read: the checklist starts their reading (src/lib/scan). */
  startScan?: boolean
  /** Where to look. */
  href: string
}

export interface ReadinessInput {
  clientId: string
  /** An analysis run (automatic or from the comparison page) is going now. */
  jobRunning: boolean
  financials: {
    /** Financial statement files uploaded. */
    fileCount: number
    comparison: { generatedAt: string; staleSince: string | null } | null
    /** Files never read (or overridden since), or a comparison out of date. */
    outOfDate: boolean
    /** Files with scanned pages still being read (src/lib/scan): not compared yet. */
    scanning?: number
    /** Failed hard checks on the comparison no staff tick covers (hardChecks.ts exportsLocked). */
    unreviewedFailures: number
    /** Staff confirmed which printed lines mean what (printed/mapping.ts): the prediction's only source of figures. */
    mappingConfirmed: boolean
    /**
     * What was read when there is no comparison (fewer than two financial years): the years shown
     * ("FY2026"), whether a current period was read, and whether any balance sheet was. Absent: as
     * before (nothing read).
     */
    read?: { annualYears: string[]; currentPeriod: boolean; balanceSheet: boolean }
    /**
     * The year the prediction's figures come from (the latest balance sheet) is not proven:
     * an uncertain scan reading (printed/proof.ts). Its reasons; absent or empty: proven.
     */
    heldReasons?: string[]
  }
  lodgement: {
    /** CSVs uploaded under the integrated client account. */
    csvCount: number
    /** unparsedDateRows above 0: the export's dates could not be read, and the analysis failed (migration 0048). */
    /**
     * icaStatus: checked against the ATO's own balance (migration 0058). Anything but 'verified' (or
     * absent, before the check existed) holds the prediction: its ATO debt and days since the last
     * payment come from the account's amounts.
     */
    analysis: { id: string; analysedAt: string; unparsedDateRows?: number; icaStatus?: string | null } | null
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

const shortDate = (iso: string) => dateText(iso)

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
  if (f.fileCount === 0) return item(input, 'financials', 'not_uploaded', null, `/clients/${input.clientId}`)
  // Scanned statements: not compared until they are read.
  if ((f.scanning ?? 0) > 0) {
    const n = f.scanning!
    return {
      ...item(input, 'financials', 'processing', `Reading ${n === 1 ? '1 scanned document' : `${n} scanned documents`} — this usually takes a few minutes. It keeps going in the background, so you can leave this page.`, href),
      startScan: true,
    }
  }
  // Processing only while the run has PDFs of its own to read: a run reading a
  // notice or the ATO export leaves statements already read as they are.
  if (f.outOfDate) return item(input, 'financials', input.jobRunning ? 'processing' : 'not_started', null, href)
  // Nothing read from the files: Failed, and why. Fewer than two years read is not a failure (25 Nov 2026):
  // the checks below run as usual and the item says what is missing.
  const read = f.read
  const somethingRead = !!read && (read.annualYears.length > 0 || read.currentPeriod)
  if (!f.comparison && !somethingRead) {
    return item(input, 'financials', 'failed', 'No profit and loss or balance sheet could be read from the uploaded files.', href)
  }
  // Fewer than two years on file (25 Nov 2026): "Needs more files", in amber, saying which year is
  // there; nothing is wrong with the PDF. An uncertain scan of it still says "Being prepared".
  if (!f.comparison && read) {
    if ((f.heldReasons ?? []).length > 0) {
      return { ...item(input, 'financials', 'needs_review', `Being prepared: ${f.heldReasons!.join('; ')}.`, href), canRunNow: false }
    }
    const then = f.mappingConfirmed ? '' : ' Then confirm the key figures on the comparison page.'
    return { ...item(input, 'financials', 'needs_files', `${fewYearsNote(read)}${then}`, href), canRunNow: false }
  }
  if (!f.mappingConfirmed) {
    return item(
      input,
      'financials',
      'needs_review',
      'Confirm the key figures (revenue, net profit, net assets, ATO debt, loan accounts) on the comparison page.',
      href,
    )
  }
  // An uncertain scan reading of the year the prediction uses: it waits (Gabby, 18 Nov 2026). No "Run now": staff choose the figures.
  if ((f.heldReasons ?? []).length > 0) {
    return { ...item(input, 'financials', 'needs_review', `Being prepared: ${f.heldReasons!.join('; ')}.`, href), canRunNow: false }
  }
  // Printed totals that do not add up never stop the prediction (Gabby, 10 Nov 2026): a note, listed on the comparison page.
  const totals =
    f.unreviewedFailures > 0
      ? `${f.unreviewedFailures === 1 ? '1 printed total does' : `${f.unreviewedFailures} printed totals do`} not add up: they are named under the year badges on the comparison page.`
      : null
  return item(input, 'financials', 'ready', totals, href)
}

/** "Only one financial year is on file (FY2026): upload an earlier year to compare." */
function fewYearsNote(read: NonNullable<ReadinessInput['financials']['read']>): string {
  const years =
    read.annualYears.length === 1
      ? `Only one financial year is on file (${read.annualYears[0]}): upload an earlier year to compare.`
      : 'No full financial year is on file yet, only the current period: upload the latest annual statements to compare.'
  return read.balanceSheet ? years : `${years} No balance sheet is on file, so the prediction has no balance sheet figures.`
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
  // Dates that could not be read (a file re-saved in Excel): failed, and the prediction refuses it.
  const unparsed = l.analysis.unparsedDateRows ?? 0
  if (unparsed > 0) return item(input, 'lodgement', 'failed', unparsedDatesMessage(unparsed), href)
  // Not verified against the ATO's own balance yet: its amounts are held back (the developer is alerted).
  if (l.analysis.icaStatus !== 'verified') {
    // No "Run now": running again cannot settle it (the developer has been alerted).
    return { ...item(input, 'lodgement', input.jobRunning ? 'processing' : 'not_started', `${TOTALS_HELD_BACK}.`, href), canRunNow: false }
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
    // A notice is used only when proven (dpn/proof.ts): one that is not holds the prediction.
    if (read.some((v) => v.proof && v.proof.status !== 'verified')) {
      return { ...item(input, 'dpn', input.jobRunning ? 'processing' : 'not_started', `${TOTALS_HELD_BACK}.`, href), canRunNow: false }
    }
    const types = [...new Set(read.map((v) => noticeTypeLabel(v.notice!) ?? 'notice'))].join(' and ')
    const badges = ['Notice adds up', 'Matches the ATO account'].filter((b) => read.every((v) => v.proof?.badges.includes(b)))
    return item(input, 'dpn', 'ready', `${read.length} notice${read.length === 1 ? '' : 's'} read (${types})${badges.length ? `: ${badges.join(' · ')}` : ''}.`, href)
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
  return i.status === 'ready' || i.status === 'failed' || i.status === 'needs_files'
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
