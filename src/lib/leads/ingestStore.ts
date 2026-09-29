import { getSupabaseServerClient } from '@/lib/supabase/server'
import type { IngestedLead } from './ingest'
import type { LeadSource } from '@/types/leads'
import type { Database } from '@/types/database'

/**
 * Persistence for inbound leads — a thin layer over the Stage 4 schema and the
 * `ingest_lead_submission` function from migration 0020.
 *
 * Never writes `last_action_at`, `last_enquiry_at` or `enquiry_count`: triggers
 * own all three. A new touch on a known lead resets the follow-up clock by
 * virtue of the activity the function inserts.
 */

export type IngestOutcome = 'created' | 'duplicate' | 'appended' | 'rejected' | 'error'

export interface IngestStoreResult {
  outcome: IngestOutcome
  leadId: string | null
}

/**
 * Record a payload we could not use. Returns 200 to the caller regardless —
 * Meta retries on any non-200, and a retry loop on a payload that will never
 * parse helps nobody.
 */
export async function logIntake(entry: {
  source: LeadSource
  externalId: string | null
  outcome: IngestOutcome
  error: string | null
  rawBody: unknown
}): Promise<void> {
  try {
    const supabase = getSupabaseServerClient()
    const { error } = await supabase.from('lead_intake_log').insert({
      source: entry.source,
      external_id: entry.externalId,
      outcome: entry.outcome,
      error: entry.error,
      // The only place a full payload is ever stored. RLS keeps it to the
      // service role; it carries names, phones and financial position.
      raw_body: entry.rawBody as never,
    })
    if (error) console.error('[logIntake] could not record intake:', error.message)
  } catch (err) {
    console.error('[logIntake] threw:', err instanceof Error ? err.message : err)
  }
}

/**
 * What the leads row says about where a lead came from.
 *
 *  - 'first_touch': the enquiry that created the lead. A partner report for
 *    August does not change when the same person enquires again in September.
 *  - 'latest_touch': the most recent enquiry, replacing source, external id and
 *    every meta_* column together.
 *
 * Every touch is in lead_submissions either way, so this only decides what the
 * row shows. Flipping it affects enquiries from then on; it does not rewrite
 * rows already stored. See CRM_CHANGES.md, "Repeat enquiries".
 */
export const ROW_ATTRIBUTION: 'first_touch' | 'latest_touch' = 'first_touch'

type IngestRpcRow = { outcome: string; lead_id: string | null }

/** What the function reads from p_submission; it sets the rest itself. */
export type SubmissionPayload = Omit<
  Database['public']['Tables']['lead_submissions']['Insert'],
  'id' | 'lead_id' | 'received_at' | 'after_close'
>

/**
 * Store an inbound lead: one enquiry, one call.
 *
 * Everything happens in `ingest_lead_submission` (migration 0020), in one
 * transaction, so a lead can never exist without its enquiry and a retry can
 * never half-apply:
 *
 *  - Same (source, external_id) as a stored enquiry — first or repeat — is a
 *    no-op: Meta retries, and people double-submit forms.
 *  - A known email is a new enquiry on the same lead, not a new lead. It is
 *    recorded in full in lead_submissions; an open lead takes the new values
 *    (a blank never wipes a known one), a converted or closed lead keeps its
 *    row and stage and is marked as having enquired again. Either way a
 *    timeline note is added, which resets the follow-up clock as before.
 *  - Emails match exactly, case-insensitively. The old lookup used `ilike`,
 *    where `_` is a wildcard, so a_b@ also matched axb@.
 */
export async function storeIngestedLead(lead: IngestedLead): Promise<IngestStoreResult> {
  const supabase = getSupabaseServerClient()

  const { data, error } = await supabase.rpc('ingest_lead_submission', {
    p_submission: toSubmissionPayload(lead),
    p_note_body: buildTouchBody(lead),
    p_note_author: sourceLabel(lead.source),
    p_latest_touch: ROW_ATTRIBUTION === 'latest_touch',
  })

  if (error) {
    console.error('[storeIngestedLead] ingest_lead_submission failed:', error.message)
    return { outcome: 'error', leadId: null }
  }

  const row = (data as IngestRpcRow[] | null)?.[0]
  if (!row || !isStoreOutcome(row.outcome)) {
    console.error('[storeIngestedLead] unexpected result from ingest_lead_submission')
    return { outcome: 'error', leadId: null }
  }
  return { outcome: row.outcome, leadId: row.lead_id }
}

/**
 * The enquiry in lead_submissions' column names, which is what the function
 * reads it as. jsonb_populate_record ignores a key it does not recognise, so
 * a misspelling would silently drop a field; the return type turns that into
 * a compile error instead.
 */
export function toSubmissionPayload(lead: IngestedLead): SubmissionPayload {
  return {
    name: lead.name,
    email: lead.email.trim().toLowerCase(),
    phone: lead.phone,
    debt_min: lead.debtMin,
    debt_max: lead.debtMax,
    state: lead.state,
    meta_state_raw: lead.metaStateRaw,
    meta_state_options: lead.metaStateOptions,
    entity_type: lead.entityType,
    message: lead.message,
    preferred_call_time: lead.preferredCallTime,
    source: lead.source,
    external_id: lead.externalId,
    meta_form_id: lead.metaFormId,
    meta_ad_id: lead.metaAdId,
    meta_adgroup_id: lead.metaAdgroupId,
    meta_page_id: lead.metaPageId,
    meta_campaign_id: lead.metaCampaignId,
    meta_campaign_name: lead.metaCampaignName,
    meta_ad_name: lead.metaAdName,
    meta_account_id: lead.metaAccountId,
  }
}

function isStoreOutcome(value: string): value is 'created' | 'duplicate' | 'appended' {
  return value === 'created' || value === 'duplicate' || value === 'appended'
}

function sourceLabel(source: LeadSource): string {
  return source === 'facebook' ? 'Facebook' : source === 'website' ? 'Website' : 'Google Form'
}

/** What the repeat enquiry actually said, so the timeline is worth reading. */
function buildTouchBody(lead: IngestedLead): string {
  const parts = [`New enquiry from the ${sourceLabel(lead.source).toLowerCase()} form.`]
  if (lead.message) parts.push(lead.message)
  if (lead.preferredCallTime) parts.push(`Preferred call time: ${lead.preferredCallTime}`)
  return parts.join('\n\n')
}
