import { getSupabaseServerClient } from '@/lib/supabase/server'
import type { IngestedLead } from './ingest'
import type { LeadSource } from '@/types/leads'

/**
 * Persistence for inbound leads — a thin layer over the Stage 4 schema.
 *
 * Never writes `last_action_at`: the trigger on lead_activities owns it, so a
 * new touch on a known lead resets the follow-up clock by virtue of the
 * activity it inserts.
 */

export type IngestOutcome = 'created' | 'duplicate' | 'appended' | 'rejected' | 'error'

export interface IngestStoreResult {
  outcome: IngestOutcome
  leadId: string | null
}

/** Postgres unique-violation. */
const UNIQUE_VIOLATION = '23505'

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
 * Store an inbound lead.
 *
 *  - Same (source, external_id) twice is a no-op: Meta retries, and people
 *    double-submit forms.
 *  - A known email is a new touch, not a new lead. Appending an activity keeps
 *    one record for Gabby to work rather than two for him to reconcile, and the
 *    trigger resets the follow-up clock.
 */
export async function storeIngestedLead(lead: IngestedLead): Promise<IngestStoreResult> {
  const supabase = getSupabaseServerClient()
  const email = lead.email.trim().toLowerCase()

  if (lead.externalId) {
    const { data: seen } = await supabase
      .from('leads')
      .select('id')
      .eq('source', lead.source)
      .eq('external_id', lead.externalId)
      .maybeSingle()
    if (seen) return { outcome: 'duplicate', leadId: seen.id }
  }

  const { data: known } = await supabase
    .from('leads')
    .select('id')
    .ilike('email', email)
    .limit(1)
    .maybeSingle()

  if (known) {
    // The existing row's attribution is left alone: it belongs to the touch
    // that created the lead, and overwriting it would rewrite where the lead
    // came from. A second touch's ad ids are therefore not kept anywhere —
    // deliberate, pending a decision on what a multi-ad lead should say.
    const { error } = await supabase.from('lead_activities').insert({
      lead_id: known.id,
      type: 'note',
      body: buildTouchBody(lead),
      author: sourceLabel(lead.source),
    })
    if (error) {
      console.error('[storeIngestedLead] activity insert failed:', error.message)
      return { outcome: 'error', leadId: known.id }
    }
    return { outcome: 'appended', leadId: known.id }
  }

  const { data: created, error } = await supabase
    .from('leads')
    .insert({
      name: lead.name,
      email,
      phone: lead.phone,
      debt_min: lead.debtMin,
      debt_max: lead.debtMax,
      state: lead.state,
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
      stage: 'lead',
    })
    .select('id')
    .single()

  if (error) {
    // Two deliveries racing: the unique index did its job, so this is a
    // duplicate rather than a failure.
    if (error.code === UNIQUE_VIOLATION) return { outcome: 'duplicate', leadId: null }
    console.error('[storeIngestedLead] insert failed:', error.message)
    return { outcome: 'error', leadId: null }
  }

  return { outcome: 'created', leadId: created.id }
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
