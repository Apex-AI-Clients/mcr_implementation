import { getSupabaseServerClient } from '@/lib/supabase/server'
import { isCustomStage } from './constants'
import type { CustomStage } from '@/types/leads'
import type { Database } from '@/types/database'

type StageRow = Database['public']['Tables']['lead_stages']['Row']

/** The longest name a stage can have; the column holds the same line. */
export const STAGE_LABEL_MAX = 40

export function rowToCustomStage(row: Pick<StageRow, 'key' | 'label' | 'position' | 'hidden_at'>): CustomStage | null {
  if (!isCustomStage(row.key)) return null
  return { key: row.key, label: row.label, position: row.position, hiddenAt: row.hidden_at }
}

/**
 * Every stage staff added, hidden ones included (a hidden stage's leads are
 * none, but its name still reads on old activity entries). Built-in stages
 * are not returned: their names live in constants.ts.
 *
 * A failure gives an empty list rather than failing the page: the built-in
 * tabs still work, and a custom tab reached by its URL falls back to Leads.
 */
export async function getCustomStages(): Promise<CustomStage[]> {
  const supabase = getSupabaseServerClient()
  const { data, error } = await supabase
    .from('lead_stages')
    .select('key, label, position, hidden_at')
    .eq('built_in', false)
    .order('position')
  if (error) {
    console.error('[getCustomStages]', error.message)
    return []
  }
  return (data ?? []).flatMap((row) => rowToCustomStage(row) ?? [])
}
