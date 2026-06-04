'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Trash2, X, AlertTriangle, Eye } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Progress } from '@/components/ui/Progress'
import { formatDate } from '@/lib/utils'
import type { ClientSummary } from '@/types/app'

interface ClientTableProps {
  clients: ClientSummary[]
}

export function ClientTable({ clients }: ClientTableProps) {
  const router = useRouter()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirm, setConfirm] = useState<ClientSummary[] | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const allVisibleSelected = clients.length > 0 && clients.every((c) => selected.has(c.id))

  function toggleAll() {
    setSelected((prev) => {
      if (allVisibleSelected) {
        const next = new Set(prev)
        clients.forEach((c) => next.delete(c.id))
        return next
      }
      const next = new Set(prev)
      clients.forEach((c) => next.add(c.id))
      return next
    })
  }

  async function handleDelete(targets: ClientSummary[]) {
    setDeleting(true)
    setError(null)
    try {
      const results = await Promise.all(
        targets.map((c) =>
          fetch(`/api/admin/clients/${c.id}`, { method: 'DELETE' })
            .then((r) => r.ok)
            .catch(() => false),
        ),
      )
      const failed = results.filter((ok) => !ok).length
      if (failed > 0) {
        setError(
          failed === targets.length
            ? 'Failed to delete. Please try again.'
            : `${failed} of ${targets.length} could not be deleted. Please retry.`,
        )
      }
      setSelected(new Set())
      setConfirm(null)
      router.refresh()
    } catch {
      setError('Failed to delete. Please try again.')
    } finally {
      setDeleting(false)
    }
  }

  if (clients.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <p className="text-foreground/40 text-sm">No clients yet. Add your first client above.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">
          {error}
        </div>
      )}

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-accent/30 bg-accent/5 px-4 py-2.5">
          <span className="text-sm text-foreground/80">
            {selected.size} selected
          </span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setSelected(new Set())}
            >
              Clear
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => setConfirm(clients.filter((c) => selected.has(c.id)))}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete selected
            </Button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-white/8">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/8 bg-surface/60">
              <th className="px-4 py-3 w-10">
                <input
                  type="checkbox"
                  aria-label="Select all clients"
                  checked={allVisibleSelected}
                  onChange={toggleAll}
                  className="accent-accent"
                />
              </th>
              <th className="px-4 py-3 text-left font-medium text-foreground/50">Client</th>
              <th className="px-4 py-3 text-left font-medium text-foreground/50">Documents</th>
              <th className="px-4 py-3 text-left font-medium text-foreground/50">Created</th>
              <th className="px-4 py-3 text-right font-medium text-foreground/50">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {clients.map((client) => {
              const progress = Math.round((client.docsReceived / client.docsTotal) * 100)
              const isSelected = selected.has(client.id)

              return (
                <tr
                  key={client.id}
                  className={`transition-colors ${isSelected ? 'bg-accent/5' : 'bg-primary hover:bg-surface/40'}`}
                >
                  <td className="px-4 py-3.5">
                    <input
                      type="checkbox"
                      aria-label={`Select ${client.name}`}
                      checked={isSelected}
                      onChange={() => toggle(client.id)}
                      className="accent-accent"
                    />
                  </td>
                  <td className="px-4 py-3.5">
                    <p className="font-medium text-foreground">{client.name}</p>
                    <p className="text-xs text-foreground/40 mt-0.5">{client.email}</p>
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
                    {client.createdAt ? formatDate(client.createdAt) : '—'}
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="flex items-center justify-end gap-1">
                      <Link
                        href={`/admin/clients/${client.id}`}
                        className="rounded-md p-1.5 text-accent hover:bg-accent/10 transition-colors"
                        title="View client"
                        aria-label={`View ${client.name}`}
                      >
                        <Eye className="h-4 w-4" />
                      </Link>
                      <button
                        type="button"
                        onClick={() => setConfirm([client])}
                        className="rounded-md p-1.5 text-destructive hover:bg-destructive/10 transition-colors"
                        title="Delete client"
                        aria-label={`Delete ${client.name}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {confirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
          onClick={() => !deleting && setConfirm(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="h-9 w-9 rounded-lg bg-destructive/10 flex items-center justify-center shrink-0">
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-foreground">
                    Delete {confirm.length === 1 ? 'client' : `${confirm.length} clients`}?
                  </h2>
                  <p className="mt-1 text-xs text-foreground/60 leading-relaxed">
                    This permanently deletes{' '}
                    {confirm.length === 1 ? (
                      <span className="text-foreground">{confirm[0].name}</span>
                    ) : (
                      <span className="text-foreground">{confirm.length} clients</span>
                    )}{' '}
                    along with all uploaded files and their accountant and company details. This
                    cannot be undone.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => !deleting && setConfirm(null)}
                className="text-foreground/40 hover:text-foreground transition-colors"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {confirm.length > 1 && (
              <ul className="mt-4 max-h-40 overflow-y-auto rounded-lg border border-border bg-surface/40 divide-y divide-border text-xs">
                {confirm.map((c) => (
                  <li key={c.id} className="px-3 py-2 text-foreground/70">
                    {c.name} <span className="text-foreground/40">· {c.email}</span>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setConfirm(null)}
                disabled={deleting}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                loading={deleting}
                onClick={() => handleDelete(confirm)}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
