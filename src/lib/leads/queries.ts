import { getSupabaseServerClient } from '@/lib/supabase/server'
import { toLead, toLeadActivity } from '@/lib/leads/rowMappers'
import type { Lead, LeadActivity } from '@/types/leads'

/**
 * Server-side reads for the CRM. Replaces the Stage 2 mock seed.
 *
 * Server-only: uses the service-role client, so this must never be imported
 * into a client component. Both functions return an empty list on error rather
 * than throwing — a CRM that renders empty with a logged error is better than a
 * 500 on the workspace chooser, which would take the SBR side down with it.
 */

/** Every lead, newest added first. The list re-sorts and filters client-side. */
export async function getLeads(): Promise<Lead[]> {
  const supabase = getSupabaseServerClient()
  const { data, error } = await supabase
    .from('leads')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[getLeads]', error.message)
    return []
  }
  return (data ?? []).map(toLead)
}

/** Every activity across all leads — the store slices these per lead. */
export async function getAllLeadActivities(): Promise<LeadActivity[]> {
  const supabase = getSupabaseServerClient()
  const { data, error } = await supabase
    .from('lead_activities')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[getAllLeadActivities]', error.message)
    return []
  }
  return (data ?? []).map(toLeadActivity)
}
