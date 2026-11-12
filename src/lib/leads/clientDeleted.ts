import type { getSupabaseServerClient } from '@/lib/supabase/server'
import { CONVERSION_ACTIVITY_BODY, FORMER_STAGE_LABELS, STAGE_META, stageLabel, visibleCustomStages } from './constants'
import { getCustomStages } from './customStages'
import { formatFullDate } from './format'
import type { BuiltInStage, CustomStage, LeadStage } from '@/types/leads'

/**
 * A client file deleted for good leaves its lead pointing at nothing:
 * leads.converted_client_id is ON DELETE SET NULL, but the stage stayed
 * "Client". Before the client row goes, its lead is set back to the stage it
 * had before conversion (recorded on the conversion entry since 24 Oct 2026),
 * else "Lead", with a stage-change entry saying when and by whom.
 *
 * Since 0052 a lead can have a file per enquiry. While another of its files
 * remains the lead stays "Client" and points at the newest remaining file;
 * only the last file going sets the stage back.
 */

type ServerClient = ReturnType<typeof getSupabaseServerClient>

/**
 * Appended to the conversion entry: which enquiry it was, and what to go back
 * to if the file is deleted. `custom`, so a stage staff added is named rather
 * than called "Custom stage". "Stage before:" stays last: it is read back.
 */
export function conversionBody(
  previous: LeadStage | null,
  custom: readonly CustomStage[] = [],
  enquiryReceivedAt: string | null = null,
): string {
  const parts = [CONVERSION_ACTIVITY_BODY]
  if (enquiryReceivedAt) parts.push(`From the enquiry of ${formatFullDate(enquiryReceivedAt)}.`)
  if (previous) parts.push(`Stage before: ${stageLabel(previous, custom)}.`)
  return parts.join(' ')
}

/** Not stages to go back to: either says there is a client file. */
const NOT_BACK_TO: LeadStage[] = ['client', 'converted']

/**
 * The stage before the lead first became a client, from its stage-change
 * entries; "lead" when not recorded. Conversion entries are read newest first,
 * passing over any made while the lead was already "Client" (a second
 * enquiry's file, 0052). Read back by name: a built-in stage's name now or
 * before 0042 ("Non-proceeding"), or a custom stage's, so long as that stage
 * still has a tab — a lead set back into a hidden stage would be on no tab at
 * all.
 */
export function stageBeforeConversion(
  activities: { type: string; body: string; created_at: string }[],
  custom: readonly CustomStage[] = [],
): LeadStage {
  for (const label of labelsBeforeConversion(activities)) {
    const stage = stageLabelled(label, custom)
    if (stage && NOT_BACK_TO.includes(stage)) continue
    return stage ?? 'lead'
  }
  return 'lead'
}

function stageLabelled(label: string, custom: readonly CustomStage[]): LeadStage | undefined {
  return builtInStageLabelled(label) ?? visibleCustomStages(custom).find((c) => c.label === label)?.key
}

/**
 * The name after "Stage before:" on each conversion entry, newest first. An
 * entry with no name ends the list: before 24 Oct 2026 the stage was not
 * recorded, so nothing older can be trusted to be the right one.
 */
function labelsBeforeConversion(activities: { type: string; body: string; created_at: string }[]): string[] {
  const labels: string[] = []
  const conversions = [...activities]
    .filter((a) => a.type === 'stage_change' && a.body.startsWith(CONVERSION_ACTIVITY_BODY))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
  for (const conversion of conversions) {
    const label = /Stage before: (.+)\.$/.exec(conversion.body)?.[1]
    if (!label) break
    labels.push(label)
  }
  return labels
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

/** On a lead that keeps other files: no stage change, just what happened. */
export function deletedKeptNote(at: Date, by: string, remaining: number): string {
  const date = new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Australia/Sydney' }).format(at)
  const files = remaining === 1 ? '1 other client file' : `${remaining} other client files`
  return `Client file deleted on ${date} by ${by}. The lead keeps ${files}, so it stays at Client.`
}

/**
 * Sets back every lead this client file came from: through the enquiry it was
 * made from (0052), or the lead's own link. Call before the client row is
 * deleted. Returns how many leads were touched.
 */
export async function releaseLeadsOfDeletedClient(supabase: ServerClient, clientId: string, by: string, at = new Date()): Promise<number> {
  const [fromEnquiries, fromLeads] = await Promise.all([
    supabase.from('lead_submissions').select('lead_id').eq('converted_client_id', clientId),
    supabase.from('leads').select('id').eq('converted_client_id', clientId),
  ])
  if (fromEnquiries.error) throw fromEnquiries.error
  if (fromLeads.error) throw fromLeads.error
  const leadIds = [
    ...new Set([
      ...(fromEnquiries.data ?? []).map((row) => row.lead_id),
      ...(fromLeads.data ?? []).map((row) => row.id),
    ]),
  ]

  const iso = at.toISOString()
  for (const leadId of leadIds) {
    // The lead's other files.
    const { data: others, error: othersError } = await supabase
      .from('lead_submissions')
      .select('converted_client_id')
      .eq('lead_id', leadId)
      .not('converted_client_id', 'is', null)
      .neq('converted_client_id', clientId)
    if (othersError) throw othersError
    const otherIds = [
      ...new Set((others ?? []).map((row) => row.converted_client_id).filter((id): id is string => !!id)),
    ]

    if (otherIds.length > 0) {
      // Stays "Client", pointing at the newest file it still has.
      const { data: newest, error: newestError } = await supabase
        .from('clients')
        .select('id')
        .in('id', otherIds)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (newestError) throw newestError
      const { error: updateError } = await supabase
        .from('leads')
        .update({ converted_client_id: newest?.id ?? otherIds[0] })
        .eq('id', leadId)
      if (updateError) throw updateError
      const { error: insertError } = await supabase.from('lead_activities').insert({
        id: crypto.randomUUID(),
        lead_id: leadId,
        type: 'note',
        body: deletedKeptNote(at, by, otherIds.length),
        author: by,
        created_at: iso,
      })
      if (insertError) throw insertError
      continue
    }

    const { data: activities, error: actError } = await supabase
      .from('lead_activities')
      .select('type, body, created_at')
      .eq('lead_id', leadId)
      .eq('type', 'stage_change')
    if (actError) throw actError
    // The custom stages are read only when an entry names one.
    const labels = labelsBeforeConversion(activities ?? [])
    const custom = labels.some((label) => !builtInStageLabelled(label)) ? await getCustomStages() : []
    const stage = stageBeforeConversion(activities ?? [], custom)
    const { error: updateError } = await supabase
      .from('leads')
      .update({ stage, converted_client_id: null, stage_since: iso })
      .eq('id', leadId)
    if (updateError) throw updateError
    const { error: insertError } = await supabase.from('lead_activities').insert({
      id: crypto.randomUUID(),
      lead_id: leadId,
      type: 'stage_change',
      body: deletedNote(at, by, stage, custom),
      author: by,
      created_at: iso,
    })
    if (insertError) throw insertError
  }
  return leadIds.length
}
