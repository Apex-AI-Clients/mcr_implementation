'use client'

import Link from 'next/link'
import { Badge } from '@/components/ui/Badge'
import { Progress } from '@/components/ui/Progress'
import { formatDateRelative } from '@/lib/utils'
import type { ClientSummary } from '@/types/app'

const STATUS_BADGE: Record<ClientSummary['status'], { label: string; variant: 'success' | 'warning' | 'destructive' | 'muted' | 'accent' }> = {
  invited: { label: 'Invited', variant: 'accent' },
  in_progress: { label: 'Uploading', variant: 'warning' },
  complete: { label: 'Complete', variant: 'success' },
  missing_items: { label: 'Missing Items', variant: 'destructive' },
}

interface ClientTableProps {
  clients: ClientSummary[]
}

export function ClientTable({ clients }: ClientTableProps) {
  if (clients.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <p className="text-foreground/40 text-sm">No clients yet. Add your first client above.</p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-white/8">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/8 bg-surface/60">
            <th className="px-4 py-3 text-left font-medium text-foreground/50">Client</th>
            <th className="px-4 py-3 text-left font-medium text-foreground/50">Status</th>
            <th className="px-4 py-3 text-left font-medium text-foreground/50">Documents</th>
            <th className="px-4 py-3 text-left font-medium text-foreground/50">Last Activity</th>
            <th className="px-4 py-3 text-left font-medium text-foreground/50"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {clients.map((client) => {
            const badge = STATUS_BADGE[client.status]
            const progress = Math.round((client.docsReceived / client.docsTotal) * 100)

            return (
              <tr key={client.id} className="bg-primary hover:bg-surface/40 transition-colors">
                <td className="px-4 py-3.5">
                  <p className="font-medium text-foreground">{client.name}</p>
                  <p className="text-xs text-foreground/40 mt-0.5">{client.email}</p>
                </td>
                <td className="px-4 py-3.5">
                  <Badge variant={badge.variant}>{badge.label}</Badge>
                </td>
                <td className="px-4 py-3.5 min-w-[160px]">
                  <div className="flex items-center gap-2">
                    <Progress value={progress} className="flex-1" />
                    <span className="text-xs text-foreground/50 tabular-nums whitespace-nowrap">
                      {client.docsReceived}/{client.docsTotal}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3.5 text-foreground/50">
                  {client.lastActivity ? formatDateRelative(client.lastActivity) : '—'}
                </td>
                <td className="px-4 py-3.5 text-right">
                  <Link
                    href={`/admin/clients/${client.id}`}
                    className="text-xs font-medium text-accent hover:text-accent/80 transition-colors"
                  >
                    View →
                  </Link>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
