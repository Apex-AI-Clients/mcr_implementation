import { getSupabaseServerClient } from '@/lib/supabase/server'
import { isCustomStage } from './constants'
import type { CustomStage, LeadStage, StageSetting } from '@/types/leads'
import type { Database } from '@/types/database'

type StageRow = Database['public']['Tables']['lead_stages']['Row']

export { STAGE_LABEL_MAX } from './customStageLimits'

export function rowToCustomStage(row: Pick<StageRow, 'key' | 'label' | 'position' | 'hidden_at'>): CustomStage | null {
  if (!isCustomStage(row.key)) return null
  return { key: row.key, label: row.label, position: row.position, hiddenAt: row.hidden_at }
}

/** Any stage row, built-in or custom (0055). */
export function rowToStage(row: Pick<StageRow, 'key' | 'label' | 'position' | 'hidden_at'> & { former_labels?: string[] | null }): StageSetting {
  return {
    key: row.key as LeadStage,
    label: row.label,
    position: row.position,
    hiddenAt: row.hidden_at,
    formerLabels: row.former_labels ?? [],
  }
}

/**
 * Every stage row: the ones staff added, hidden ones included (a hidden
 * stage's leads are none, but its name still reads on old activity entries),
 * and the built-in ones (0055), whose label is their name once Gabby renames
 * them and whose position orders the tabs. Passed as the stage list to
 * stageLabel(), viewDef() and allViews().
 *
 * A failure gives an empty list rather than failing the page: the built-in
 * tabs still work, and a custom tab reached by its URL falls back to Leads.
 */
export async function getCustomStages(): Promise<StageSetting[]> {
  const supabase = getSupabaseServerClient()
  const query = (columns: string) => supabase.from('lead_stages').select(columns).order('position')
  // former_labels arrives with 0055; read without it until then.
  let { data, error } = await query('key, label, position, hidden_at, former_labels')
  if (error?.code === '42703') ({ data, error } = await query('key, label, position, hidden_at'))
  if (error) {
    console.error('[getCustomStages]', error.message)
    return []
  }
  return ((data ?? []) as unknown as Parameters<typeof rowToStage>[0][]).map(rowToStage)
}
