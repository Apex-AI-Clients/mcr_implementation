import { getSupabaseServerClient } from '@/lib/supabase/server'
import { CHECKLIST_ORDER } from '@/lib/constants'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function AdminDashboardPage() {
  const supabase = await getSupabaseServerClient()

  const { data: clients } = await supabase
    .from('clients')
    .select('id, name, status, created_at')
    .order('created_at', { ascending: false })

  const { data: documents } = await supabase
    .from('documents')
    .select('client_id, doc_category, status')

  const total = clients?.length ?? 0
  const complete = clients?.filter((c) => c.status === 'complete').length ?? 0
  const inProgress = clients?.filter((c) => c.status === 'in_progress').length ?? 0
  const missing = clients?.filter((c) => c.status === 'missing_items').length ?? 0

  // Count unique categories per client
  const docsPerClient = new Map<string, Set<string>>()
  for (const doc of documents ?? []) {
    if (!docsPerClient.has(doc.client_id)) docsPerClient.set(doc.client_id, new Set())
    if (doc.status !== 'rejected') {
      docsPerClient.get(doc.client_id)!.add(doc.doc_category)
    }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-8">
        <h1 className="text-xl font-semibold text-foreground">Dashboard</h1>
        <p className="mt-1 text-sm text-foreground/50">Overview of all active client files</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-8">
        <StatCard label="Total Clients" value={total} />
        <StatCard label="Complete" value={complete} color="success" />
        <StatCard label="Uploading" value={inProgress} color="warning" />
        <StatCard label="Missing Items" value={missing} color="destructive" />
      </div>

      {/* Recent clients */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Clients</CardTitle>
          <Link href="/admin/clients" className="text-xs text-accent hover:text-accent/80">
            View all
          </Link>
        </CardHeader>
        <div className="flex flex-col gap-2">
          {(clients ?? []).slice(0, 8).map((client) => {
            const categories = docsPerClient.get(client.id)?.size ?? 0
            const pct = Math.round((categories / CHECKLIST_ORDER.length) * 100)
            return (
              <Link
                key={client.id}
                href={`/admin/clients/${client.id}`}
                className="flex items-center justify-between rounded-lg border border-white/6 bg-primary/40 px-3 py-2.5 hover:bg-surface/40 transition-colors"
              >
                <div>
                  <p className="text-sm font-medium text-foreground">{client.name}</p>
                  <p className="text-xs text-foreground/40">
                    {categories}/{CHECKLIST_ORDER.length} categories
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-1.5 w-20 overflow-hidden rounded-full bg-primary">
                    <div
                      className={`h-full rounded-full ${pct === 100 ? 'bg-success' : pct > 50 ? 'bg-warning' : 'bg-accent'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <StatusBadge status={client.status} />
                </div>
              </Link>
            )
          })}
          {total === 0 && (
            <p className="py-8 text-center text-sm text-foreground/30">
              No clients yet.{' '}
              <Link href="/admin/clients" className="text-accent underline">
                Add your first client
              </Link>
            </p>
          )}
        </div>
      </Card>
    </div>
  )
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string
  value: number
  color?: 'success' | 'warning' | 'destructive'
}) {
  return (
    <div className="rounded-xl border border-white/8 bg-surface p-4">
      <p className="text-2xl font-bold text-foreground">{value}</p>
      <p className={`text-xs mt-1 ${color ? `text-${color}` : 'text-foreground/50'}`}>{label}</p>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<
    string,
    { label: string; variant: 'success' | 'warning' | 'destructive' | 'muted' | 'accent' }
  > = {
    invited: { label: 'Invited', variant: 'accent' },
    in_progress: { label: 'Uploading', variant: 'warning' },
    complete: { label: 'Complete', variant: 'success' },
    missing_items: { label: 'Missing', variant: 'destructive' },
  }
  const { label, variant } = map[status] ?? { label: status, variant: 'muted' }
  return <Badge variant={variant}>{label}</Badge>
}
