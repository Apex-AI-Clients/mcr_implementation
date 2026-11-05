import type { getSupabaseServerClient } from '@/lib/supabase/server'

type ServerClient = ReturnType<typeof getSupabaseServerClient>

/**
 * A CVL case and its client, for the routes that act on it. `open`: the file
 * is in CVL (its case not removed from CVL, migration 0047), so its forms can
 * be changed and generated. `inSbr`: also an SBR client on the SBR list.
 */
export interface CaseAccess {
  id: string
  clientId: string
  status: string
  formsPreparedAt: string | null
  printedAt: string | null
  clientName: string
  open: boolean
  inSbr: boolean
  /** 'cvl': a CVL-only file (never an SBR client, or not yet). */
  workflow: 'sbr' | 'cvl'
}

export async function loadCaseAccess(supabase: ServerClient, caseId: string): Promise<CaseAccess | null> {
  const { data } = await supabase
    .from('cvl_cases')
    .select('id, client_id, status, forms_prepared_at, printed_at, removed_at, clients(name, archived_at, workflow)')
    .eq('id', caseId)
    .maybeSingle()
  if (!data) return null
  const client = (Array.isArray(data.clients) ? data.clients[0] : data.clients) as
    | { name: string; archived_at: string | null; workflow: string }
    | null
    | undefined
  return {
    id: data.id,
    clientId: data.client_id,
    status: data.status,
    formsPreparedAt: data.forms_prepared_at,
    printedAt: data.printed_at,
    clientName: client?.name ?? '',
    open: !!client && !data.removed_at,
    inSbr: !!client && client.workflow === 'sbr' && !client.archived_at,
    workflow: client?.workflow === 'cvl' ? 'cvl' : 'sbr',
  }
}
