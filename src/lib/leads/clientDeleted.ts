import type { getSupabaseServerClient } from '@/lib/supabase/server'
import { CONVERSION_ACTIVITY_BODY, STAGE_META } from './constants'
import type { LeadStage } from '@/types/leads'

/**
 * A client file deleted for good leaves its lead pointing at nothing:
 * leads.converted_client_id is ON DELETE SET NULL, but the stage stayed
 * "Client". Before the client row goes, its lead is set back to the stage it
 * had before conversion (recorded on the conversion entry since 24 Oct 2026),
 * else "Lead", with a stage-change entry saying when and by whom.
 */

type ServerClient = ReturnType<typeof getSupabaseServerClient>

/** Appended to the conversion entry: what to go back to if the file is deleted. */
export function conversionBody(previous: LeadStage | null): string {
  return previous ? `${CONVERSION_ACTIVITY_BODY} Stage before: ${STAGE_META[previous].label}.` : CONVERSION_ACTIVITY_BODY
}

/** Not stages to go back to: either says there is a client file. */
const NOT_BACK_TO: LeadStage[] = ['client', 'converted']

/** The stage before the latest conversion, from the lead's stage-change entries; "lead" when not recorded. */
export function stageBeforeConversion(activities: { type: string; body: string; created_at: string }[]): LeadStage {
  const conversion = [...activities]
    .filter((a) => a.type === 'stage_change' && a.body.startsWith(CONVERSION_ACTIVITY_BODY))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
  const label = conversion && /Stage before: (.+)\.$/.exec(conversion.body)?.[1]
  const stage = (Object.keys(STAGE_META) as LeadStage[]).find((s) => STAGE_META[s].label === label)
  return stage && !NOT_BACK_TO.includes(stage) ? stage : 'lead'
}

export function deletedNote(at: Date, by: string, stage: LeadStage): string {
  const date = new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Australia/Sydney' }).format(at)
  return `Client file deleted on ${date} by ${by}. Stage set back to ${STAGE_META[stage].label}.`
}

/** Sets back every lead converted into this client. Call before the client row is deleted. */
export async function releaseLeadsOfDeletedClient(supabase: ServerClient, clientId: string, by: string, at = new Date()): Promise<number> {
  const { data: leads, error } = await supabase.from('leads').select('id').eq('converted_client_id', clientId)
  if (error) throw error
  for (const lead of leads ?? []) {
    const { data: activities, error: actError } = await supabase
      .from('lead_activities')
      .select('type, body, created_at')
      .eq('lead_id', lead.id)
      .eq('type', 'stage_change')
    if (actError) throw actError
    const stage = stageBeforeConversion(activities ?? [])
    const iso = at.toISOString()
    const { error: updateError } = await supabase
      .from('leads')
      .update({ stage, converted_client_id: null, stage_since: iso })
      .eq('id', lead.id)
    if (updateError) throw updateError
    const { error: insertError } = await supabase.from('lead_activities').insert({
      id: crypto.randomUUID(),
      lead_id: lead.id,
      type: 'stage_change',
      body: deletedNote(at, by, stage),
      author: by,
      created_at: iso,
    })
    if (insertError) throw insertError
  }
  return leads?.length ?? 0
}
