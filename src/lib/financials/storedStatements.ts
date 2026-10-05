import type { getSupabaseServerClient } from '@/lib/supabase/server'
import { toStoredSlot } from './halves'
import type { StoredStatementSlot } from './types'

/**
 * Server-only. Every stored statement slot for a client, read as halves
 * (legacy rows included — see halves.ts). The one way readers load
 * financial_statements, so none of them meets a half-empty row unprepared.
 */

type ServerClient = ReturnType<typeof getSupabaseServerClient>

export async function loadStoredSlots(
  supabase: ServerClient,
  clientId: string,
): Promise<StoredStatementSlot[]> {
  const { data, error } = await supabase
    .from('financial_statements')
    .select('*')
    .eq('client_id', clientId)
    .order('financial_year', { ascending: true })
  if (error) throw new Error(`Failed to load statements: ${error.message}`)
  return (data ?? []).map(toStoredSlot)
}
