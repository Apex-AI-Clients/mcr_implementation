import { ENTITY_TYPE_META, SOURCE_META } from '@/lib/leads/constants'
import {
  describeUncertainState,
  formatDebtRange,
  formatFullDate,
  formatLeadSource,
  formatPhone,
} from '@/lib/leads/format'
import type { Lead, LeadSubmission } from '@/types/leads'

/**
 * How repeat enquiries show on a lead. Pure, so the rules are testable apart
 * from the table and record that render them.
 *
 * Every enquiry is a row in lead_submissions (migration 0020); the lead row
 * carries a count, the latest date, and — for a converted or closed lead that
 * enquired again — a marker that stays until a stage change or a dismissal.
 */

/**
 * Whether the "New enquiry after conversion/closure" marker is showing.
 *
 * Set by the ingest function, cleared by any stage change. A dismissal does not
 * clear it: it records who and when, and the marker hides while the dismissal
 * is the later of the two — so the next enquiry brings it back.
 */
export function showsReenquiryMarker(
  lead: Pick<Lead, 'reenquiredAfterCloseAt' | 'reenquiryDismissedAt'>,
): boolean {
  if (!lead.reenquiredAfterCloseAt) return false
  if (!lead.reenquiryDismissedAt) return true
  return Date.parse(lead.reenquiryDismissedAt) < Date.parse(lead.reenquiredAfterCloseAt)
}

/**
 * The marker's words. "Conversion" when a client file exists or the lead is
 * marked converted; "closure" for non-proceeding and do-not-contact.
 */
export function reenquiryMarkerLabel(lead: Pick<Lead, 'convertedClientId' | 'stage'>): string {
  const converted = lead.convertedClientId !== null || lead.stage === 'converted'
  return converted ? 'New enquiry after conversion' : 'New enquiry after closure'
}

/** "3 enquiries". Only ever shown for two or more. */
export function enquiryCountLabel(count: number): string {
  return `${count} enquiries`
}

/**
 * The "N enquiries" tooltip: "Latest from Website, 26 Aug 2026", or the date
 * alone when the source was not loaded.
 */
export function describeLatestEnquiry(
  lead: Pick<Lead, 'lastEnquiryAt' | 'latestEnquirySource'>,
): string {
  const date = formatFullDate(lead.lastEnquiryAt)
  return lead.latestEnquirySource
    ? `Latest from ${SOURCE_META[lead.latestEnquirySource].label}, ${date}`
    : `Latest ${date}`
}

// ============================================================
// The record's Enquiries list
// ============================================================

export interface EnquiryField {
  label: string
  /** What to show. Null when the enquiry did not give this field. */
  value: string | null
  /** Given, and different from what the enquiry before it said. */
  changed: boolean
}

/**
 * Every field of one enquiry, in the record's order, each marked `changed`
 * when it differs from the enquiry before it (`previous`, the next-older one).
 *
 * A field this enquiry left blank is never `changed`: blank never overwrote
 * anything on the lead, so highlighting it would point at a change that did
 * not happen. It shows as "not given" instead. The oldest enquiry has nothing
 * to differ from, so nothing on it is highlighted.
 *
 * Values are compared the way they are shown — the same number in two phone
 * formats, or an email in two cases, is not a change.
 */
export function enquiryFields(
  enquiry: LeadSubmission,
  previous: LeadSubmission | undefined,
): EnquiryField[] {
  const rows: [label: string, read: (e: LeadSubmission) => string | null][] = [
    ['Name', (e) => blankToNull(e.name)],
    ['Email', (e) => blankToNull(e.email)?.toLowerCase() ?? null],
    ['Phone', (e) => (blankToNull(e.phone) ? formatPhone(e.phone) : null)],
    [
      'Debt',
      (e) =>
        e.debtMin === null && e.debtMax === null
          ? null
          : formatDebtRange(e.debtMin, e.debtMax, 'full'),
    ],
    ['State', (e) => e.state ?? describeUncertainState(e)?.description ?? null],
    ['Business type', (e) => (e.entityType ? ENTITY_TYPE_META[e.entityType].label : null)],
    ['Preferred call time', (e) => blankToNull(e.preferredCallTime)],
    ['Message', (e) => blankToNull(e.message)],
  ]

  return rows.map(([label, read]) => {
    const value = read(enquiry)
    const before = previous ? read(previous) : null
    return {
      label,
      value,
      changed: previous !== undefined && value !== null && value !== before,
    }
  })
}

/**
 * Where an enquiry came from, most specific first: "Facebook · EPIC DM",
 * then the campaign and ad by name where Meta resolved them, else the form.
 */
export function describeEnquirySource(enquiry: LeadSubmission): string[] {
  const parts = [formatLeadSource(enquiry)]
  if (enquiry.metaCampaignName) parts.push(`Campaign: ${enquiry.metaCampaignName}`)
  if (enquiry.metaAdName) parts.push(`Ad: ${enquiry.metaAdName}`)
  else if (enquiry.metaAdId) parts.push(`Ad ${enquiry.metaAdId}`)
  if (enquiry.metaFormId) parts.push(`Form ${enquiry.metaFormId}`)
  return parts
}

function blankToNull(value: string | null): string | null {
  return value && value.trim() ? value.trim() : null
}
