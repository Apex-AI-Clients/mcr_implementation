'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Archive, AlertTriangle, Eye, RotateCcw, Trash2, X, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Progress } from '@/components/ui/Progress'
import { formatDate } from '@/lib/utils'
import { archiveReasonLabel } from '@/lib/clients/archive'
import type { ClientSummary } from '@/types/app'

interface ClientTableProps {
  clients: ClientSummary[]
  /**
   * 'active' is the SBR client list: rows can be archived. 'archived' is the
   * Archive: rows can be made clients again or deleted permanently. Nothing is
   * ever deleted from the client list itself.
   */
  mode?: 'active' | 'archived'
}

type Action = 'archive' | 'restore' | 'delete'

interface ActionMeta {
  verb: string
  icon: LucideIcon
  destructive: boolean
  request: (id: string) => Promise<Response>
  title: (count: number) => string
  /** The sentence after the names. */
  consequence: (count: number) => string
  failed: string
}

const ACTIONS: Record<Action, ActionMeta> = {
  archive: {
    verb: 'Archive',
    icon: Archive,
    destructive: false,
    request: (id) => fetch(`/api/admin/clients/${id}/archive`, { method: 'POST' }),
    title: (count) => (count === 1 ? 'Archive this client?' : `Archive ${count} clients?`),
    consequence: (count) =>
      `${count === 1 ? 'leaves' : 'leave'} the client list and ${count === 1 ? 'moves' : 'move'} to the Archive. Nothing is deleted: from the Archive you can make ${count === 1 ? 'them a client' : 'them clients'} again, or delete permanently.`,
    failed: 'archived',
  },
  restore: {
    verb: 'Make client again',
    icon: RotateCcw,
    destructive: false,
    request: (id) => fetch(`/api/admin/clients/${id}/restore`, { method: 'POST' }),
    title: (count) => (count === 1 ? 'Make this a client again?' : `Make ${count} clients again?`),
    consequence: (count) =>
      `${count === 1 ? 'goes' : 'go'} back on the client list exactly as ${count === 1 ? 'it was' : 'they were'} archived.`,
    failed: 'restored',
  },
  delete: {
    verb: 'Delete permanently',
    icon: Trash2,
    destructive: true,
    request: (id) => fetch(`/api/admin/clients/${id}`, { method: 'DELETE' }),
    title: (count) => (count === 1 ? 'Delete permanently?' : `Delete ${count} clients permanently?`),
    consequence: () =>
      'will be permanently deleted, along with all uploaded files and their accountant and company details. This cannot be undone.',
    failed: 'deleted',
  },
}

export function ClientTable({ clients, mode = 'active' }: ClientTableProps) {
  const router = useRouter()
  const archived = mode === 'archived'
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirm, setConfirm] = useState<{ action: Action; targets: ClientSummary[] } | null>(
    null,
  )
  const [working, setWorking] = useState(false)
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
      const next = new Set(prev)
      if (allVisibleSelected) clients.forEach((c) => next.delete(c.id))
      else clients.forEach((c) => next.add(c.id))
      return next
    })
  }

  function ask(action: Action, targets: ClientSummary[]) {
    setError(null)
    setConfirm({ action, targets })
  }

  async function run(action: Action, targets: ClientSummary[]) {
    const meta = ACTIONS[action]
    setWorking(true)
    setError(null)
    try {
      const results = await Promise.all(
        targets.map((c) =>
          meta
            .request(c.id)
            .then((r) => r.ok)
            .catch(() => false),
        ),
      )
      const failed = results.filter((ok) => !ok).length
      if (failed > 0) {
        setError(
          failed === targets.length
            ? `Could not be ${meta.failed}. Please try again.`
            : `${failed} of ${targets.length} could not be ${meta.failed}. Please retry.`,
        )
      }
      setSelected(new Set())
      setConfirm(null)
      router.refresh()
    } catch {
      setError(`Could not be ${meta.failed}. Please try again.`)
    } finally {
      setWorking(false)
    }
  }

  if (clients.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <p className="text-foreground/40 text-sm">
          {archived
            ? 'Nothing in the Archive.'
            : 'No clients yet. Add your first client above.'}
        </p>
      </div>
    )
  }

  const selectedClients = clients.filter((c) => selected.has(c.id))
  const bulkActions: Action[] = archived ? ['restore', 'delete'] : ['archive']
  const rowActions: Action[] = archived ? ['restore', 'delete'] : ['archive']

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">
          {error}
        </div>
      )}

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-accent/30 bg-accent/5 px-4 py-2.5">
          <span className="text-sm text-foreground/80">{selected.size} selected</span>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
            {bulkActions.map((action) => {
              const meta = ACTIONS[action]
              const Icon = meta.icon
              return (
                <Button
                  key={action}
                  type="button"
                  variant={meta.destructive ? 'destructive' : 'primary'}
                  size="sm"
                  onClick={() => ask(action, selectedClients)}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {meta.verb} selected
                </Button>
              )
            })}
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
              <th className="px-4 py-3 text-left font-medium text-foreground/50">
                {archived ? 'Archived' : 'Created'}
              </th>
              <th className="px-4 py-3 text-right font-medium text-foreground/50">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {clients.map((client) => {
              const progress = Math.round((client.docsReceived / client.docsTotal) * 100)
              const isSelected = selected.has(client.id)
              const href = archived ? `/sbr/archive/${client.id}` : `/clients/${client.id}`

              return (
                <tr
                  key={client.id}
                  // The whole row opens the file. The checkbox, the eye link and
                  // the action buttons keep their own clicks; keyboard users have
                  // the eye link.
                  onClick={(event) => {
                    if ((event.target as HTMLElement).closest('a, button, input, label')) return
                    router.push(href)
                  }}
                  className={`cursor-pointer transition-colors ${isSelected ? 'bg-accent/5' : 'bg-primary hover:bg-surface/40'}`}
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
                    {archived ? (
                      <>
                        <p>{client.archivedAt ? formatDate(client.archivedAt) : '—'}</p>
                        {archiveReasonLabel(client.archivedReason) && (
                          <p className="mt-0.5 text-xs text-foreground/40">
                            {archiveReasonLabel(client.archivedReason)}
                          </p>
                        )}
                      </>
                    ) : client.createdAt ? (
                      formatDate(client.createdAt)
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="flex items-center justify-end gap-1">
                      <Link
                        href={href}
                        className="rounded-md p-1.5 text-accent hover:bg-accent/10 transition-colors"
                        title="View client"
                        aria-label={`View ${client.name}`}
                      >
                        <Eye className="h-4 w-4" />
                      </Link>
                      {rowActions.map((action) => {
                        const meta = ACTIONS[action]
                        const Icon = meta.icon
                        return (
                          <button
                            key={action}
                            type="button"
                            onClick={() => ask(action, [client])}
                            className={`rounded-md p-1.5 transition-colors ${
                              meta.destructive
                                ? 'text-destructive hover:bg-destructive/10'
                                : 'text-foreground/60 hover:bg-surface hover:text-foreground'
                            }`}
                            title={meta.verb}
                            aria-label={`${meta.verb}: ${client.name}`}
                          >
                            <Icon className="h-4 w-4" />
                          </button>
                        )
                      })}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {confirm && (
        <ConfirmAction
          action={confirm.action}
          targets={confirm.targets}
          working={working}
          onCancel={() => !working && setConfirm(null)}
          onConfirm={() => run(confirm.action, confirm.targets)}
        />
      )}
    </div>
  )
}

function ConfirmAction({
  action,
  targets,
  working,
  onCancel,
  onConfirm,
}: {
  action: Action
  targets: ClientSummary[]
  working: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const meta = ACTIONS[action]
  const Icon = meta.icon
  const count = targets.length

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={meta.title(count)}
        className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div
              className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${
                meta.destructive ? 'bg-destructive/10' : 'bg-accent/10'
              }`}
            >
              {meta.destructive ? (
                <AlertTriangle className="h-4 w-4 text-destructive" />
              ) : (
                <Icon className="h-4 w-4 text-accent" />
              )}
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground">{meta.title(count)}</h2>
              <p className="mt-1 text-xs text-foreground/60 leading-relaxed">
                <span className="text-foreground">
                  {count === 1 ? targets[0].name : `These ${count} clients`}
                </span>{' '}
                {meta.consequence(count)}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="text-foreground/40 hover:text-foreground transition-colors"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {count > 1 && (
          <ul className="mt-4 max-h-40 overflow-y-auto rounded-lg border border-border bg-surface/40 divide-y divide-border text-xs">
            {targets.map((c) => (
              <li key={c.id} className="px-3 py-2 text-foreground/70">
                {c.name} <span className="text-foreground/40">· {c.email}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={working}>
            Cancel
          </Button>
          <Button
            type="button"
            variant={meta.destructive ? 'destructive' : 'primary'}
            size="sm"
            loading={working}
            onClick={onConfirm}
          >
            <Icon className="h-3.5 w-3.5" />
            {meta.verb}
          </Button>
        </div>
      </div>
    </div>
  )
}
