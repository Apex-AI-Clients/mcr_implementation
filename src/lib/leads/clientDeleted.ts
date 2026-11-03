import type { getSupabaseServerClient } from '@/lib/supabase/server'
import { CONVERSION_ACTIVITY_BODY, FORMER_STAGE_LABELS, STAGE_META, stageLabel, visibleCustomStages } from './constants'
import { getCustomStages } from './customStages'
import type { BuiltInStage, CustomStage, LeadStage } from '@/types/leads'

/**
 * A client file deleted for good leaves its lead pointing at nothing:
 * leads.converted_client_id is ON DELETE SET NULL, but the stage stayed
 * "Client". Before the client row goes, its lead is set back to the stage it
 * had before conversion (recorded on the conversion entry since 24 Oct 2026),
 * else "Lead", with a stage-change entry saying when and by whom.
 */

type ServerClient = ReturnType<typeof getSupabaseServerClient>

/**
 * Appended to the conversion entry: what to go back to if the file is deleted.
 * `custom`, so a stage staff added is named rather than called "Custom stage".
 */
export function conversionBody(previous: LeadStage | null, custom: readonly CustomStage[] = []): string {
  return previous ? `${CONVERSION_ACTIVITY_BODY} Stage before: ${stageLabel(previous, custom)}.` : CONVERSION_ACTIVITY_BODY
}

/** Not stages to go back to: either says there is a client file. */
const NOT_BACK_TO: LeadStage[] = ['client', 'converted']

/**
 * The stage before the latest conversion, from the lead's stage-change
 * entries; "lead" when not recorded. Read back by name: a built-in stage's
 * name now or before 0042 ("Non-proceeding"), or a custom stage's, so long as
 * that stage still has a tab — a lead set back into a hidden stage would be on
 * no tab at all.
 */
export function stageBeforeConversion(
  activities: { type: string; body: string; created_at: string }[],
  custom: readonly CustomStage[] = [],
): LeadStage {
  const label = labelBeforeConversion(activities)
  if (!label) return 'lead'
  const stage: LeadStage | undefined =
    builtInStageLabelled(label) ?? visibleCustomStages(custom).find((c) => c.label === label)?.key
  return stage && !NOT_BACK_TO.includes(stage) ? stage : 'lead'
}

/** The name after "Stage before:" on the latest conversion entry, if any. */
function labelBeforeConversion(activities: { type: string; body: string; created_at: string }[]): string | null {
  const conversion = [...activities]
    .filter((a) => a.type === 'stage_change' && a.body.startsWith(CONVERSION_ACTIVITY_BODY))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
  return (conversion && /Stage before: (.+)\.$/.exec(conversion.body)?.[1]) || null
}

function builtInStageLabelled(label: string): BuiltInStage | undefined {
  return (Object.keys(STAGE_META) as BuiltInStage[]).find(
    (s) => STAGE_META[s].label === label || FORMER_STAGE_LABELS[s] === label,
  )
}

export function deletedNote(at: Date, by: string, stage: LeadStage, custom: readonly CustomStage[] = []): string {
  const date = new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Australia/Sydney' }).format(at)
  return `Client file deleted on ${date} by ${by}. Stage set back to ${stageLabel(stage, custom)}.`
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
    // The custom stages are read only when the entry names one.
    const label = labelBeforeConversion(activities ?? [])
    const custom = label && !builtInStageLabelled(label) ? await getCustomStages() : []
    const stage = stageBeforeConversion(activities ?? [], custom)
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
      body: deletedNote(at, by, stage, custom),
      author: by,
      created_at: iso,
    })
    if (insertError) throw insertError
  }
  return leads?.length ?? 0
}
