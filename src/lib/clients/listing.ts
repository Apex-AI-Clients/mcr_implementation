import { getSupabaseServerClient } from '@/lib/supabase/server'
import { CHECKLIST_ORDER } from '@/lib/constants'
import type { ClientSummary } from '@/types/app'

/**
 * One page of the client list, or of the Archive — the same rows, the same
 * search and the same document counts, so the two lists never drift apart.
 *
 *   archived: false  active files, newest created first
 *   archived: true   archived files, most recently archived first
 */

export const CLIENTS_PAGE_SIZE = 10

export interface ClientListPage {
  clients: ClientSummary[]
  total: number
  page: number
  pageSize: number
  query: string
}

export async function getClientListPage(options: {
  q?: string
  page?: string
  archived: boolean
}): Promise<ClientListPage> {
  const q = (options.q ?? '').trim()
  // Sanitise for the PostgREST or() filter (strip operators that break syntax).
  const safeQ = q.replace(/[%,()]/g, ' ').trim()
  const page = Math.max(1, Number.parseInt(options.page ?? '1', 10) || 1)
  const from = (page - 1) * CLIENTS_PAGE_SIZE
  const to = from + CLIENTS_PAGE_SIZE - 1

  const supabase = getSupabaseServerClient()

  let query = supabase
    .from('clients')
    .select(
      'id, name, email, status, ato_admin_confirmed, created_at, updated_at, archived_at, archived_reason',
      { count: 'exact' },
    )
  query = options.archived ? query.not('archived_at', 'is', null) : query.is('archived_at', null)
  if (safeQ) {
    query = query.or(`name.ilike.%${safeQ}%,email.ilike.%${safeQ}%`)
  }
  const { data: clients, count } = await query
    .order(options.archived ? 'archived_at' : 'created_at', { ascending: false })
    .range(from, to)

  const pageClients = clients ?? []
  const ids = pageClients.map((c) => c.id)

  // Doc counts + accountant flags only for the clients on this page.
  const [{ data: documents }, { data: accountantDetails }] = await Promise.all([
    ids.length
      ? supabase
          .from('documents')
          .select('client_id, doc_category, status, uploaded_at')
          .in('client_id', ids)
      : Promise.resolve({
          data: [] as { client_id: string; doc_category: string; status: string; uploaded_at: string }[],
        }),
    ids.length
      ? supabase.from('accountant_details').select('client_id').in('client_id', ids)
      : Promise.resolve({ data: [] as { client_id: string }[] }),
  ])

  const accountantSet = new Set((accountantDetails ?? []).map((a) => a.client_id))

  const docMap = new Map<string, { categories: Set<string>; lastActivity: string | null }>()
  for (const doc of documents ?? []) {
    if (!docMap.has(doc.client_id)) {
      docMap.set(doc.client_id, { categories: new Set(), lastActivity: null })
    }
    const entry = docMap.get(doc.client_id)!
    if (doc.status !== 'rejected') entry.categories.add(doc.doc_category)
    if (!entry.lastActivity || doc.uploaded_at > entry.lastActivity) {
      entry.lastActivity = doc.uploaded_at
    }
  }

  const summaries: ClientSummary[] = pageClients.map((c) => ({
    id: c.id,
    name: c.name,
    email: c.email,
    status: c.status as ClientSummary['status'],
    docsReceived: docMap.get(c.id)?.categories.size ?? 0,
    docsTotal: CHECKLIST_ORDER.length,
    atoAdminConfirmed: c.ato_admin_confirmed,
    hasAccountantDetails: accountantSet.has(c.id),
    lastActivity: docMap.get(c.id)?.lastActivity ?? null,
    createdAt: c.created_at,
    archivedAt: c.archived_at,
    archivedReason: c.archived_reason,
  }))

  return { clients: summaries, total: count ?? 0, page, pageSize: CLIENTS_PAGE_SIZE, query: q }
}
