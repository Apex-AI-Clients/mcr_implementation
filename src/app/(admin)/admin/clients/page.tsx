import { getSupabaseServerClient } from '@/lib/supabase/server'
import { CHECKLIST_ORDER } from '@/lib/constants'
import { ClientsPageClient } from '@/components/admin/ClientsPageClient'
import { InviteClientForm } from '@/components/admin/InviteClientForm'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import type { ClientSummary } from '@/types/app'

export const dynamic = 'force-dynamic'

export default async function ClientsPage() {
  const supabase = await getSupabaseServerClient()

  const { data: clients } = await supabase
    .from('clients')
    .select('id, name, email, status, ato_admin_confirmed, created_at, updated_at')
    .order('created_at', { ascending: false })

  const { data: documents } = await supabase
    .from('documents')
    .select('client_id, doc_category, status, uploaded_at')

  const { data: accountantDetails } = await supabase
    .from('accountant_details')
    .select('client_id')

  const accountantSet = new Set((accountantDetails ?? []).map((a) => a.client_id))

  // Build per-client summaries
  const docMap = new Map<string, { categories: Set<string>; lastActivity: string | null }>()
  for (const doc of documents ?? []) {
    const existing = docMap.get(doc.client_id)
    if (!existing) {
      docMap.set(doc.client_id, { categories: new Set(), lastActivity: null })
    }
    const entry = docMap.get(doc.client_id)!
    if (doc.status !== 'rejected') {
      entry.categories.add(doc.doc_category)
    }
    if (!entry.lastActivity || doc.uploaded_at > entry.lastActivity) {
      entry.lastActivity = doc.uploaded_at
    }
  }

  const summaries: ClientSummary[] = (clients ?? []).map((c) => ({
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

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-8">
        <h1 className="text-xl font-semibold text-foreground">Clients</h1>
        <p className="mt-1 text-sm text-foreground/50">
          {summaries.length} {summaries.length === 1 ? 'client' : 'clients'} total
        </p>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Add New Client</CardTitle>
        </CardHeader>
        <InviteClientForm />
      </Card>

      <ClientsPageClient clients={summaries} />
    </div>
  )
}
