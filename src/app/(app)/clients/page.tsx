import Link from 'next/link'
import { UserPlus } from 'lucide-react'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { CHECKLIST_ORDER } from '@/lib/constants'
import { ClientsPageClient } from '@/components/admin/ClientsPageClient'
import type { ClientSummary } from '@/types/app'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 10

interface Props {
  searchParams: Promise<{ q?: string; page?: string }>
}

export default async function ClientsPage({ searchParams }: Props) {
  const sp = await searchParams
  const q = (sp.q ?? '').trim()
  // Sanitise for the PostgREST or() filter (strip operators that break syntax).
  const safeQ = q.replace(/[%,()]/g, ' ').trim()
  const page = Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1)
  const from = (page - 1) * PAGE_SIZE
  const to = from + PAGE_SIZE - 1

  const supabase = getSupabaseServerClient()

  let query = supabase
    .from('clients')
    .select('id, name, email, status, ato_admin_confirmed, created_at, updated_at', {
      count: 'exact',
    })
  if (safeQ) {
    query = query.or(`name.ilike.%${safeQ}%,email.ilike.%${safeQ}%`)
  }
  const { data: clients, count } = await query
    .order('created_at', { ascending: false })
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
      : Promise.resolve({ data: [] as { client_id: string; doc_category: string; status: string; uploaded_at: string }[] }),
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
  }))

  const total = count ?? 0

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Clients</h1>
          <p className="mt-1 text-sm text-foreground/50">
            {total} {total === 1 ? 'client' : 'clients'} total
          </p>
        </div>
        <Link
          href="/clients/new/intake"
          className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent/90"
        >
          <UserPlus className="h-4 w-4" />
          Add Client
        </Link>
      </div>

      <ClientsPageClient
        clients={summaries}
        total={total}
        page={page}
        pageSize={PAGE_SIZE}
        query={q}
      />
    </div>
  )
}
