import { getCompletenessSummary } from '@/lib/clients/completeness'
import { Badge } from '@/components/ui/Badge'
import { formatDateRelative } from '@/lib/utils'
import Link from 'next/link'
import {
  Users,
  FileText,
  CheckCircle2,
  Clock,
  ArrowRight,
  type LucideIcon,
} from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function SbrDashboardPage() {
  // "Complete" is defined once in the shared helper — the workspace chooser
  // reports the same numbers from the same source.
  const {
    clients,
    requiredTotal,
    totalClients: total,
    totalDocuments,
    completeClients: completedClients,
    awaitingDocuments: inProgressClients,
    requiredCollected: collected,
    requiredPossible: maxPossible,
    overallPct,
  } = await getCompletenessSummary()

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-8">
        <h1 className="text-xl font-semibold text-foreground">Dashboard</h1>
        <p className="mt-1 text-sm text-foreground/50">Overview of all active client files</p>
      </div>

      {/* Stats — derived from real document data */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 mb-6">
        <StatCard label="Total Clients" value={total} icon={Users} />
        <StatCard label="Documents Collected" value={totalDocuments} icon={FileText} />
        <StatCard label="Clients Complete" value={completedClients} icon={CheckCircle2} color="success" />
        <StatCard label="Awaiting Documents" value={inProgressClients} icon={Clock} color="warning" />
      </div>

      {/* Portfolio completeness — a dashboard-only summary metric */}
      <div className="mb-8 rounded-xl border border-border bg-card p-5">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-foreground/40">
              Document collection progress
            </p>
            <p className="mt-1 text-sm text-foreground/60">
              {collected} of {maxPossible} required document categories received across all clients
            </p>
          </div>
          <span className="text-2xl font-bold text-foreground tabular-nums">{overallPct}%</span>
        </div>
        <div className="mt-4 h-2.5 w-full overflow-hidden rounded-full bg-primary">
          <div
            className="h-full rounded-full bg-accent transition-all"
            style={{ width: `${overallPct}%` }}
          />
        </div>
      </div>

      {/* Recent clients — card grid, deliberately distinct from the Clients table */}
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">Recent Clients</h2>
        <Link
          href="/clients"
          className="inline-flex items-center gap-1 text-xs text-accent hover:text-accent/80"
        >
          View all
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {total === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-12 text-center">
          <p className="text-sm text-foreground/40">
            No clients yet.{' '}
            <Link href="/clients" className="text-accent underline">
              Add your first client
            </Link>
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {clients.slice(0, 6).map((client) => {
            const { requiredMet: met, pct, isComplete } = client
            return (
              <Link
                key={client.id}
                href={`/clients/${client.id}`}
                className="group flex flex-col gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-accent/40 hover:bg-surface/40"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{client.name}</p>
                    <p className="mt-0.5 text-xs text-foreground/40">
                      Added {formatDateRelative(client.createdAt)}
                    </p>
                  </div>
                  <Badge variant={isComplete ? 'success' : 'warning'}>
                    {isComplete ? 'Complete' : 'In progress'}
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-primary">
                    <div
                      className={`h-full rounded-full ${isComplete ? 'bg-success' : pct > 50 ? 'bg-warning' : 'bg-accent'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-xs text-foreground/50 tabular-nums whitespace-nowrap">
                    {met}/{requiredTotal} required
                  </span>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

function StatCard({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string
  value: number
  icon: LucideIcon
  color?: 'success' | 'warning' | 'destructive'
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <p className="text-2xl font-bold text-foreground">{value}</p>
        <Icon className={`h-5 w-5 ${color ? `text-${color}` : 'text-foreground/30'}`} />
      </div>
      <p className={`text-xs mt-1 ${color ? `text-${color}` : 'text-foreground/50'}`}>{label}</p>
    </div>
  )
}
