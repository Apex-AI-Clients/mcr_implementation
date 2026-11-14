import { getSupabaseServerClient } from '@/lib/supabase/server'
import { unmappedFacebookKeys, unmappedWebsiteKeys } from './ingest'
import { FIELD_MAPS } from './ingestConfig'

/**
 * Facebook lead form health, for the warning strip on a lead's record page —
 * shown on the leads from an affected form, not over the whole list.
 *
 * Why: form 1751128836351174 went live on 4 Nov 2026 with a state question key
 * no field map listed. Every lead from it landed with a blank State and the
 * webhook reported success, so it was noticed a week later, by hand. This
 * surfaces the same kind of gap the day it starts.
 *
 * Computed when the record loads, from what is already stored — no cron,
 * no extra table, nothing added to the webhook:
 *
 *  - Unmapped key: a question name (lead_submissions.meta_field_keys, from
 *    migration 0051) that the CURRENT field map does not claim. Because it is
 *    checked against the map as deployed, the warning clears as soon as the key
 *    is added — older leads that carried it do not keep it on screen.
 *  - Blank State / Debt: the form's latest BLANK_STREAK leads all arrived with
 *    it empty. One skipped answer is a lead's choice; three in a row is a form.
 *  - Missing name / email / phone: such a lead is turned away, not stored, and
 *    its payload goes to lead_intake_log. Any in the window is flagged: those
 *    are enquiries staff never saw. Only the form id is read from that log —
 *    never the payload.
 *
 * Counts, form ids and question names only. Never an answer.
 */

/** How far back the check looks. */
export const FORM_HEALTH_WINDOW_DAYS = 14

/** Consecutive latest leads with a field blank before it is flagged. */
export const BLANK_STREAK = 3

export interface HealthSubmission {
  meta_form_id: string | null
  received_at: string
  /** Absent until migration 0051 is applied; null on enquiries stored before it. */
  meta_field_keys?: string[] | null
  state: string | null
  meta_state_raw: string | null
  meta_state_options: string[] | null
  debt_min: number | null
  debt_max: number | null
  /** Debt typed but not an amount is still an answer (0053). Absent before 0053. */
  debt_text?: string | null
  /** Website check only: whether a business type was read. */
  entity_type?: string | null
}

export interface HealthRejection {
  form_id: string | null
  error: string | null
  created_at: string
}

/** Which lead forms: Facebook's, or the website's (0053). Facebook when absent. */
export type HealthSource = 'facebook' | 'website'

export type FormHealthIssue = { source?: HealthSource } & (
  | { kind: 'unmapped_key'; formId: string; key: string; leads: number; isNew: boolean }
  | { kind: 'blank_field'; formId: string; field: 'state' | 'debt' | 'business_type'; streak: number; isNew: boolean }
  | { kind: 'rejected'; formId: string; field: 'name' | 'email' | 'phone'; leads: number; isNew: boolean }
)

/** "1751128836351174" -> "175112…", as staff will see it. "unknown" stays whole. */
export function shortFormId(formId: string): string {
  return /^\d{7,}$/.test(formId) ? `${formId.slice(0, 6)}…` : formId
}

const FIELD_LABEL = { state: 'State', debt: 'Debt', name: 'name', email: 'email', phone: 'phone number' }

/** "Facebook form 175112…", "Website form website_results", "Website leads with no form id". */
function formLabel(issue: FormHealthIssue): string {
  if (issue.source === 'website') {
    return issue.formId === 'unknown' ? 'Website leads with no form id' : `Website form ${issue.formId}`
  }
  return `${issue.isNew ? 'New Facebook form' : 'Facebook form'} ${shortFormId(issue.formId)}`
}

/** The sentence on the dashboard. */
export function formHealthMessage(issue: FormHealthIssue): string {
  const form = formLabel(issue)
  switch (issue.kind) {
    case 'unmapped_key':
      return `${form} ${issue.formId === 'unknown' && issue.source === 'website' ? 'are' : 'is'} sending a field we don't recognise: ${issue.key}`
    case 'blank_field':
      if (issue.field === 'business_type') {
        return `${form}: its last ${issue.streak} leads sent a business type we could not read.`
      }
      return `${form}: its last ${issue.streak} leads arrived with no ${FIELD_LABEL[issue.field]}.`
    case 'rejected':
      return `${form}: ${issue.leads} ${issue.leads === 1 ? 'lead was' : 'leads were'} turned away for a missing ${FIELD_LABEL[issue.field]} in the last ${FORM_HEALTH_WINDOW_DAYS} days.`
  }
}

function stateBlank(s: HealthSubmission): boolean {
  return s.state === null && !s.meta_state_raw?.trim() && !s.meta_state_options?.length
}

function debtBlank(s: HealthSubmission): boolean {
  return s.debt_min === null && s.debt_max === null && !s.debt_text?.trim()
}

/** Website: the form sent its business type key, and nothing could be read from it. */
function businessTypeUnread(s: HealthSubmission): boolean {
  const sent = (s.meta_field_keys ?? []).some((key) => FIELD_MAPS.website.entityType.includes(key))
  return sent && !s.entity_type
}

/**
 * Pure. `submissions` and `rejections` are the window's Facebook rows;
 * `newForms` holds the forms whose first enquiry ever falls inside the window.
 * Ordered unmapped keys first (the cause), then rejections, then blanks.
 */
export function assessFacebookFormHealth(
  submissions: HealthSubmission[],
  rejections: HealthRejection[],
  newForms: ReadonlySet<string> = new Set(),
): FormHealthIssue[] {
  return assessFormHealth('facebook', submissions, rejections, newForms)
}

/**
 * The same checks for either source. The website's differ in two ways: its
 * keys are checked against the website field map, and a business type is
 * flagged only when the form sends one that cannot be read — a form that does
 * not ask (the results-page form) is not a fault.
 */
export function assessFormHealth(
  source: HealthSource,
  submissions: HealthSubmission[],
  rejections: HealthRejection[],
  newForms: ReadonlySet<string> = new Set(),
): FormHealthIssue[] {
  const tag = source === 'website' ? { source } : {}
  const unmappedKeys = source === 'website' ? unmappedWebsiteKeys : unmappedFacebookKeys
  const unmapped: FormHealthIssue[] = []
  const blanks: FormHealthIssue[] = []
  const rejected: FormHealthIssue[] = []

  const byForm = new Map<string, HealthSubmission[]>()
  for (const s of submissions) {
    const formId = s.meta_form_id ?? 'unknown'
    const list = byForm.get(formId) ?? []
    list.push(s)
    byForm.set(formId, list)
  }

  for (const [formId, rows] of byForm) {
    const isNew = newForms.has(formId)

    const keyCounts = new Map<string, number>()
    for (const row of rows) {
      for (const key of unmappedKeys(row.meta_field_keys ?? [])) {
        keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1)
      }
    }
    for (const [key, leads] of keyCounts) unmapped.push({ ...tag, kind: 'unmapped_key', formId, key, leads, isNew })

    const latest = [...rows].sort((a, b) => b.received_at.localeCompare(a.received_at)).slice(0, BLANK_STREAK)
    if (latest.length === BLANK_STREAK) {
      if (latest.every(stateBlank)) blanks.push({ ...tag, kind: 'blank_field', formId, field: 'state', streak: BLANK_STREAK, isNew })
      if (latest.every(debtBlank)) blanks.push({ ...tag, kind: 'blank_field', formId, field: 'debt', streak: BLANK_STREAK, isNew })
      if (source === 'website' && latest.every(businessTypeUnread)) {
        blanks.push({ ...tag, kind: 'blank_field', formId, field: 'business_type', streak: BLANK_STREAK, isNew })
      }
    }
  }

  const rejectionCounts = new Map<string, { formId: string; field: 'name' | 'email' | 'phone'; leads: number }>()
  for (const r of rejections) {
    const match = /^Missing (name|email|phone)\b/.exec(r.error ?? '')
    if (!match) continue
    const field = match[1] as 'name' | 'email' | 'phone'
    const formId = r.form_id ?? 'unknown'
    const id = `${formId}:${field}`
    const entry = rejectionCounts.get(id) ?? { formId, field, leads: 0 }
    entry.leads++
    rejectionCounts.set(id, entry)
  }
  for (const entry of rejectionCounts.values()) {
    rejected.push({ ...tag, kind: 'rejected', ...entry, isNew: newForms.has(entry.formId) })
  }

  return [...unmapped, ...rejected, ...blanks]
}

const SUBMISSION_COLUMNS =
  'meta_form_id, received_at, state, meta_state_raw, meta_state_options, debt_min, debt_max'

/**
 * The lead record's call: warnings for the Facebook forms this lead's
 * enquiries came from, and no others. Never throws: a failed health check must
 * not take the lead record down with it, so any error is logged and reads as
 * "no warnings".
 */
export async function getFacebookFormHealth(
  formIds: readonly string[],
  now: Date = new Date(),
): Promise<string[]> {
  const forms = new Set(formIds.filter(Boolean))
  if (forms.size === 0) return []
  try {
    const supabase = getSupabaseServerClient()
    const since = new Date(now.getTime() - FORM_HEALTH_WINDOW_DAYS * 86_400_000).toISOString()
    const formList = [...forms]

    // meta_field_keys arrives with migration 0051. Until it is applied the
    // column is missing (42703), and the check runs without unmapped keys.
    // The two selects return different row shapes, so each gets its own
    // variable; both are read as HealthSubmission, where the keys are optional.
    const withKeys = await supabase
      .from('lead_submissions')
      .select(`${SUBMISSION_COLUMNS}, meta_field_keys`)
      .eq('source', 'facebook')
      .in('meta_form_id', formList)
      .gte('received_at', since)
    let subs = withKeys.data as HealthSubmission[] | null
    let error = withKeys.error
    if (error?.code === '42703') {
      const withoutKeys = await supabase
        .from('lead_submissions')
        .select(SUBMISSION_COLUMNS)
        .eq('source', 'facebook')
        .in('meta_form_id', formList)
        .gte('received_at', since)
      subs = withoutKeys.data as HealthSubmission[] | null
      error = withoutKeys.error
    }
    if (error) throw new Error(`lead_submissions: ${error.message}`)

    // Only the form id and the error text — the payload carries the lead.
    const { data: logs, error: logError } = await supabase
      .from('lead_intake_log')
      .select('error, created_at, form_id:raw_body->>form_id')
      .eq('source', 'facebook')
      .eq('outcome', 'rejected')
      .gte('created_at', since)
    if (logError) throw new Error(`lead_intake_log: ${logError.message}`)

    const submissions = (subs ?? []) as HealthSubmission[]
    // The form id sits inside the logged payload, so it is matched here.
    const rejections = ((logs ?? []) as HealthRejection[]).filter(
      (r) => r.form_id !== null && forms.has(r.form_id),
    )
    const issues = assessFacebookFormHealth(submissions, rejections)
    if (issues.length === 0) return []

    // "New" = no enquiry from the form before the window.
    const flagged = [...new Set(issues.map((i) => i.formId).filter((id) => id !== 'unknown'))]
    // One query per flagged form — there are only ever a few — so a busy form's
    // history cannot crowd another form out of a shared row limit.
    const older = new Set<string>()
    for (const formId of flagged) {
      const { data: before, error: beforeError } = await supabase
        .from('lead_submissions')
        .select('meta_form_id')
        .eq('source', 'facebook')
        .eq('meta_form_id', formId)
        .lt('received_at', since)
        .limit(1)
      if (beforeError) throw new Error(`lead_submissions (history): ${beforeError.message}`)
      if (before && before.length > 0) older.add(formId)
    }
    const newForms = new Set(flagged.filter((id) => !older.has(id)))

    return assessFacebookFormHealth(submissions, rejections, newForms).map(formHealthMessage)
  } catch (err) {
    console.error('[leads/formHealth] check failed:', err instanceof Error ? err.message : err)
    return []
  }
}

/**
 * The same check for the website forms this lead's enquiries came from (0053).
 * `formIds` are the form ids the website posted, with 'unknown' for enquiries
 * that came with none (every website enquiry until the forms post form_id).
 *
 * Website volume is small, so the window's website enquiries are read once
 * and matched to the forms here. No "new form" marking: the website's forms
 * are ours, not launched from an ad account. Never throws, like the Facebook
 * check.
 */
export async function getWebsiteFormHealth(
  formIds: readonly string[],
  now: Date = new Date(),
): Promise<string[]> {
  const forms = new Set(formIds.filter(Boolean))
  if (forms.size === 0) return []
  try {
    const supabase = getSupabaseServerClient()
    const since = new Date(now.getTime() - FORM_HEALTH_WINDOW_DAYS * 86_400_000).toISOString()
    const columns = `${SUBMISSION_COLUMNS}, meta_field_keys, entity_type`

    // debt_text arrives with migration 0053; until then the check runs without it.
    const withText = await supabase
      .from('lead_submissions')
      .select(`${columns}, debt_text`)
      .eq('source', 'website')
      .gte('received_at', since)
    let subs = withText.data as HealthSubmission[] | null
    let error = withText.error
    if (error?.code === '42703') {
      const withoutText = await supabase.from('lead_submissions').select(columns).eq('source', 'website').gte('received_at', since)
      subs = withoutText.data as HealthSubmission[] | null
      error = withoutText.error
    }
    if (error) throw new Error(`lead_submissions: ${error.message}`)

    // Only the form id and the error text — the payload carries the lead.
    const { data: logs, error: logError } = await supabase
      .from('lead_intake_log')
      .select('error, created_at, form_id:raw_body->>form_id')
      .eq('source', 'website')
      .eq('outcome', 'rejected')
      .gte('created_at', since)
    if (logError) throw new Error(`lead_intake_log: ${logError.message}`)

    const submissions = ((subs ?? []) as HealthSubmission[]).filter((s) => forms.has(s.meta_form_id ?? 'unknown'))
    const rejections = ((logs ?? []) as HealthRejection[]).filter((r) => forms.has(r.form_id ?? 'unknown'))
    return assessFormHealth('website', submissions, rejections).map(formHealthMessage)
  } catch (err) {
    console.error('[leads/formHealth] website check failed:', err instanceof Error ? err.message : err)
    return []
  }
}
