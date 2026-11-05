import { getSupabaseServerClient } from '@/lib/supabase/server'
import { readCvlStatus, type CvlOrigin, type CvlStatus } from './cases'

/**
 * The CVL client list, and "Moved to CVL" in the SBR Archive. Both read
 * cvl_cases with their client (migration 0039), so a page of rows is one
 * query in the order shown.
 *
 *   cvl clients    every CVL file not archived, newest case first
 *   moved to CVL   files converted from SBR, most recently moved first
 */

export const CVL_PAGE_SIZE = 20

export interface CvlListRow {
  caseId: string
  clientId: string
  name: string
  email: string
  origin: CvlOrigin
  status: CvlStatus
  formsPreparedAt: string | null
  printedAt: string | null
  sbrArchivedAt: string | null
  sbrArchivedBy: string | null
  createdAt: string
  /** Also an SBR client on the SBR list (migration 0047). */
  inSbr: boolean
}

export interface CvlListPage {
  rows: CvlListRow[]
  total: number
  page: number
  pageSize: number
  query: string
}

interface CaseClient {
  name: string
  email: string
  workflow: string
  archived_at: string | null
}

interface CaseWithClient {
  id: string
  client_id: string
  origin: string
  status: string
  forms_prepared_at: string | null
  printed_at: string | null
  sbr_archived_at: string | null
  sbr_archived_by: string | null
  created_at: string
  clients: CaseClient | CaseClient[] | null
}

export async function getCvlListPage(options: { q?: string; page?: string }): Promise<CvlListPage> {
  const q = (options.q ?? '').trim()
  const safeQ = q.replace(/[%,()]/g, ' ').trim()
  const page = Math.max(1, Number.parseInt(options.page ?? '1', 10) || 1)
  const from = (page - 1) * CVL_PAGE_SIZE

  const supabase = getSupabaseServerClient()
  let query = supabase
    .from('cvl_cases')
    .select(
      'id, client_id, origin, status, forms_prepared_at, printed_at, sbr_archived_at, sbr_archived_by, created_at, clients!inner(name, email, workflow, archived_at)',
      { count: 'exact' },
    )
    // In CVL: the case is not removed from CVL (0047). A file archived from
    // SBR only stays here; one also in SBR is on both lists.
    .is('removed_at', null)
  if (safeQ) query = query.or(`name.ilike.%${safeQ}%,email.ilike.%${safeQ}%`, { referencedTable: 'clients' })

  const { data, count, error } = await query
    .order('created_at', { ascending: false })
    .range(from, from + CVL_PAGE_SIZE - 1)
  if (error) throw error

  const rows = ((data ?? []) as unknown as CaseWithClient[]).map((r) => {
    const client = Array.isArray(r.clients) ? r.clients[0] : r.clients
    return {
      caseId: r.id,
      clientId: r.client_id,
      name: client?.name ?? '',
      email: client?.email ?? '',
      origin: (r.origin === 'sbr_client' ? 'sbr_client' : 'lead') as CvlOrigin,
      status: readCvlStatus(r.status),
      formsPreparedAt: r.forms_prepared_at,
      printedAt: r.printed_at,
      sbrArchivedAt: r.sbr_archived_at,
      sbrArchivedBy: r.sbr_archived_by,
      createdAt: r.created_at,
      inSbr: client?.workflow === 'sbr' && !client.archived_at,
    }
  })

  return { rows, total: count ?? 0, page, pageSize: CVL_PAGE_SIZE, query: q }
}
