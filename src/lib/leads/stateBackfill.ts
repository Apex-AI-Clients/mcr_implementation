import { getSupabaseServerClient } from '@/lib/supabase/server'
import type { AuState } from '@/types/leads'
import { flattenFacebookFields, mapState, resolveLeadState, type StateMapping } from './ingest'
import { fetchLead } from './metaGraph'

/**
 * One-off: fill the blank State on leads from Facebook form 1751128836351174.
 *
 * That form went live on 4 Nov 2026 with a state question key no field map
 * listed, so every lead from it landed with no State. Nothing stored holds the
 * answers — a successful lead keeps only the mapped columns — so each lead is
 * re-read from Meta by its leadgen id and run through the same
 * `resolveLeadState` the webhook now uses.
 *
 * Meta keeps a lead for 90 days. The first lead from this form arrived on
 * 4 Nov 2026, so this has to run before early February 2027; after that the
 * fetch returns nothing and the lead is counted as not found.
 *
 * Rules:
 *  - Fills only where state, meta_state_raw and meta_state_options are ALL
 *    empty, on the lead row and on each enquiry row separately. The guard is
 *    in the UPDATE itself, so a State staff typed in between the dry run and
 *    the real run is never overwritten.
 *  - An answer that does not resolve to a state is kept verbatim in
 *    meta_state_raw, exactly as the webhook does — never dropped.
 *  - The lead row takes its latest enquiry with an answer, the same rule a
 *    repeat enquiry follows at ingest.
 *  - No timeline note: one would reset the follow-up clock on every lead.
 *  - Reports counts only. No answer, name or id leaves this module.
 */

export const STATE_BACKFILL_FORM_ID = '1751128836351174'

/**
 * Enquiries the form had received when this was written: 16 webhook log lines
 * from 4–11 Nov 2026 — 15 leads, one of them with a repeat enquiry. The run
 * reports whether it saw exactly this many, so a missing enquiry is noticed
 * rather than silently skipped. More is fine if the form kept running.
 */
export const STATE_BACKFILL_EXPECTED_ENQUIRIES = 16

type StateColumns = {
  state: AuState | null
  meta_state_raw: string | null
  meta_state_options: AuState[] | null
}

export interface BackfillSubmission extends StateColumns {
  id: string
  lead_id: string
  external_id: string | null
  meta_page_id: string | null
  received_at: string
}

export interface BackfillLead extends StateColumns {
  id: string
}

/** What Meta gave back for one enquiry. */
export type BackfillAnswer = { kind: 'not_found' } | { kind: 'found'; mapping: StateMapping }

export interface StateBackfillCounts {
  /** Enquiries on the form. */
  submissions: number
  /** Re-read from Meta. */
  found: number
  /** Meta returned nothing: expired, deleted, or the token failed. */
  notFound: number
  /** Answer resolved to a state or a group of states. */
  recognised: number
  /** Answer given but not a state we know — kept as raw text. */
  unrecognisedAnswer: number
  /** Question left blank, or not on the lead at all. */
  blankInMeta: number
  submissionsFilled: number
  /** Enquiry rows that already had something in a State column. */
  submissionsAlreadySet: number
  leadsFilled: number
  leadsAlreadySet: number
}

export interface StateBackfillPlan {
  counts: StateBackfillCounts
  submissionUpdates: Array<{ id: string; columns: StateColumns }>
  leadUpdates: Array<{ id: string; columns: StateColumns }>
}

function isBlank(row: StateColumns): boolean {
  return (
    row.state === null &&
    (row.meta_state_raw === null || row.meta_state_raw.trim() === '') &&
    (row.meta_state_options === null || row.meta_state_options.length === 0)
  )
}

/** A state mapping as the three columns, or null when there is nothing to store. */
export function stateColumns(mapping: StateMapping): StateColumns | null {
  switch (mapping.kind) {
    case 'state':
      return { state: mapping.state, meta_state_raw: null, meta_state_options: null }
    case 'group':
      return { state: null, meta_state_raw: mapping.label, meta_state_options: mapping.states }
    case 'unresolved':
      return { state: null, meta_state_raw: mapping.raw, meta_state_options: null }
    case 'absent':
      return null
  }
}

/** Pure: what would be written, and the counts. */
export function planStateBackfill(
  submissions: BackfillSubmission[],
  leads: BackfillLead[],
  answers: Map<string, BackfillAnswer>,
): StateBackfillPlan {
  const counts: StateBackfillCounts = {
    submissions: submissions.length,
    found: 0,
    notFound: 0,
    recognised: 0,
    unrecognisedAnswer: 0,
    blankInMeta: 0,
    submissionsFilled: 0,
    submissionsAlreadySet: 0,
    leadsFilled: 0,
    leadsAlreadySet: 0,
  }
  const submissionUpdates: StateBackfillPlan['submissionUpdates'] = []
  // Per lead, the latest enquiry with an answer.
  const latestForLead = new Map<string, { receivedAt: string; columns: StateColumns }>()

  for (const sub of submissions) {
    const answer = answers.get(sub.id) ?? { kind: 'not_found' }
    if (answer.kind === 'not_found') {
      counts.notFound++
      continue
    }
    counts.found++

    const columns = stateColumns(answer.mapping)
    if (!columns) {
      counts.blankInMeta++
      continue
    }
    if (answer.mapping.kind === 'unresolved') counts.unrecognisedAnswer++
    else counts.recognised++

    if (isBlank(sub)) {
      submissionUpdates.push({ id: sub.id, columns })
      counts.submissionsFilled++
    } else {
      counts.submissionsAlreadySet++
    }

    const current = latestForLead.get(sub.lead_id)
    if (!current || sub.received_at > current.receivedAt) {
      latestForLead.set(sub.lead_id, { receivedAt: sub.received_at, columns })
    }
  }

  const leadUpdates: StateBackfillPlan['leadUpdates'] = []
  for (const lead of leads) {
    const latest = latestForLead.get(lead.id)
    if (!latest) continue
    if (isBlank(lead)) {
      leadUpdates.push({ id: lead.id, columns: latest.columns })
      counts.leadsFilled++
    } else {
      counts.leadsAlreadySet++
    }
  }

  return { counts, submissionUpdates, leadUpdates }
}

export interface StateBackfillResult {
  dryRun: boolean
  formId: string
  counts: StateBackfillCounts
  /** What counts.submissions should be (STATE_BACKFILL_EXPECTED_ENQUIRIES); compare the two. */
  expectedEnquiries: number
}

/**
 * Re-read every enquiry from the form and, unless `dryRun`, write the plan.
 * In a real run, submissionsFilled / leadsFilled are the rows the guarded
 * UPDATE actually changed, which can be lower than planned if staff filled a
 * State in the meantime.
 */
export async function runStateBackfill(
  { dryRun, formId = STATE_BACKFILL_FORM_ID }: { dryRun: boolean; formId?: string },
  fetchLeadFn: typeof fetchLead = fetchLead,
): Promise<StateBackfillResult> {
  const supabase = getSupabaseServerClient()

  const { data: subs, error: subsError } = await supabase
    .from('lead_submissions')
    .select('id, lead_id, external_id, meta_page_id, received_at, state, meta_state_raw, meta_state_options')
    .eq('source', 'facebook')
    .eq('meta_form_id', formId)
  if (subsError) throw new Error(`Could not read enquiries: ${subsError.message}`)
  const submissions = (subs ?? []) as BackfillSubmission[]

  const leadIds = [...new Set(submissions.map((s) => s.lead_id))]
  let leads: BackfillLead[] = []
  if (leadIds.length > 0) {
    const { data, error } = await supabase
      .from('leads')
      .select('id, state, meta_state_raw, meta_state_options')
      .in('id', leadIds)
    if (error) throw new Error(`Could not read leads: ${error.message}`)
    leads = (data ?? []) as BackfillLead[]
  }

  // Sequential: a few dozen leads at most, and Meta rate-limits per page token.
  const answers = new Map<string, BackfillAnswer>()
  for (const sub of submissions) {
    if (!sub.external_id) {
      answers.set(sub.id, { kind: 'not_found' })
      continue
    }
    const fetched = await fetchLeadFn(sub.external_id, sub.meta_page_id)
    if (!fetched) {
      answers.set(sub.id, { kind: 'not_found' })
      continue
    }
    const payload = flattenFacebookFields(fetched.fieldData, formId)
    answers.set(sub.id, { kind: 'found', mapping: resolveLeadState(payload, 'facebook', formId) })
  }

  const plan = planStateBackfill(submissions, leads, answers)
  const expectedEnquiries = STATE_BACKFILL_EXPECTED_ENQUIRIES
  if (dryRun) return { dryRun, formId, expectedEnquiries, counts: plan.counts }

  let submissionsFilled = 0
  for (const update of plan.submissionUpdates) {
    const { data, error } = await supabase
      .from('lead_submissions')
      .update(update.columns)
      .eq('id', update.id)
      .is('state', null)
      .is('meta_state_raw', null)
      .is('meta_state_options', null)
      .select('id')
    if (error) throw new Error(`Could not update an enquiry: ${error.message}`)
    submissionsFilled += data?.length ?? 0
  }

  let leadsFilled = 0
  for (const update of plan.leadUpdates) {
    const { data, error } = await supabase
      .from('leads')
      .update(update.columns)
      .eq('id', update.id)
      .is('state', null)
      .is('meta_state_raw', null)
      .is('meta_state_options', null)
      .select('id')
    if (error) throw new Error(`Could not update a lead: ${error.message}`)
    leadsFilled += data?.length ?? 0
  }

  return { dryRun, formId, expectedEnquiries, counts: { ...plan.counts, submissionsFilled, leadsFilled } }
}

// ============================================================
// Re-reading stored raw state text with the current normaliser
// ============================================================

/**
 * A row whose State is held only as raw text: an answer that did not resolve
 * when it arrived. A resolved grouping also keeps its label in meta_state_raw,
 * but it has meta_state_options set and is never one of these.
 */
export interface RawStateRow {
  id: string
  meta_state_raw: string
}

export interface RawStateCounts {
  /** Rows holding raw text only, before. */
  before: number
  /** Now resolve to exactly one state — these are updated. */
  nowState: number
  /** Now resolve to several states. Not updated: that is not "a state". */
  nowGroup: number
  /** Still not a state. Left as they are. */
  stillUnresolved: number
  /** Rows holding raw text only, after. before − (rows actually updated). */
  after: number
}

/**
 * Pure: which raw-text rows the current `mapState` now reads as one state.
 * No Meta call — the stored text is the answer. Only a single state counts;
 * the raw text is cleared when the state is set, exactly as at ingest.
 */
export function planRawStateRenormalise(rows: RawStateRow[]): {
  counts: RawStateCounts
  updates: Array<{ id: string; raw: string; state: AuState }>
} {
  const updates: Array<{ id: string; raw: string; state: AuState }> = []
  let nowGroup = 0
  let stillUnresolved = 0
  for (const row of rows) {
    const mapping = mapState(row.meta_state_raw)
    if (mapping.kind === 'state') updates.push({ id: row.id, raw: row.meta_state_raw, state: mapping.state })
    else if (mapping.kind === 'group') nowGroup++
    else stillUnresolved++
  }
  return {
    counts: {
      before: rows.length,
      nowState: updates.length,
      nowGroup,
      stillUnresolved,
      after: rows.length - updates.length,
    },
    updates,
  }
}

export interface RawStateRenormaliseResult {
  dryRun: boolean
  leads: RawStateCounts
  submissions: RawStateCounts
}

/**
 * Every source, not just Facebook: the normaliser is the same for all of them.
 * Each UPDATE is guarded on the row still holding the same raw text and no
 * state or options, so an edit made since the read is never overwritten. In a
 * real run, `after` is computed from the rows actually changed.
 */
export async function runRawStateRenormalise({
  dryRun,
}: {
  dryRun: boolean
}): Promise<RawStateRenormaliseResult> {
  const supabase = getSupabaseServerClient()

  async function one(table: 'leads' | 'lead_submissions'): Promise<RawStateCounts> {
    const { data, error } = await supabase
      .from(table)
      .select('id, meta_state_raw')
      .is('state', null)
      .is('meta_state_options', null)
      .not('meta_state_raw', 'is', null)
    if (error) throw new Error(`Could not read ${table}: ${error.message}`)
    const rows = ((data ?? []) as Array<{ id: string; meta_state_raw: string | null }>).filter(
      (row): row is RawStateRow => typeof row.meta_state_raw === 'string' && row.meta_state_raw.trim() !== '',
    )
    const plan = planRawStateRenormalise(rows)
    if (dryRun) return plan.counts

    let updated = 0
    for (const update of plan.updates) {
      const { data: changed, error: updateError } = await supabase
        .from(table)
        .update({ state: update.state, meta_state_raw: null, meta_state_options: null })
        .eq('id', update.id)
        .eq('meta_state_raw', update.raw)
        .is('state', null)
        .is('meta_state_options', null)
        .select('id')
      if (updateError) throw new Error(`Could not update ${table}: ${updateError.message}`)
      updated += changed?.length ?? 0
    }
    return { ...plan.counts, nowState: updated, after: plan.counts.before - updated }
  }

  return { dryRun, leads: await one('leads'), submissions: await one('lead_submissions') }
}
