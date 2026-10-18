'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertTriangle, ArrowRight, CheckCircle2, Circle, Clock, Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { formatDate } from '@/lib/utils'
import { STATUS_LABEL, type Readiness, type ReadinessItem, type ReadinessStatus } from '@/lib/sbr/readiness'

interface ReadinessChecklistProps {
  clientId: string
  readiness: Readiness
}

const BADGE: Record<ReadinessStatus, 'muted' | 'accent' | 'success' | 'warning'> = {
  not_uploaded: 'muted',
  not_started: 'muted',
  processing: 'accent',
  ready: 'success',
  needs_review: 'warning',
}

function StatusIcon({ item }: { item: ReadinessItem }) {
  if (item.status === 'ready' || item.review) return <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
  if (item.status === 'processing') return <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent" aria-hidden="true" />
  if (item.status === 'not_started') return <Clock className="h-4 w-4 shrink-0 text-foreground/40" aria-hidden="true" />
  if (item.status === 'needs_review') return <AlertTriangle className="h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
  return <Circle className="h-4 w-4 shrink-0 text-foreground/25" aria-hidden="true" />
}

/**
 * What the SBR outcome prediction needs, item by item: Not uploaded, Not run
 * yet, Processing, Ready or Needs review. A Needs review item is cleared by
 * marking it reviewed; Not run yet offers Run now. Processing means a run is
 * actually going, so it offers nothing.
 */
export function ReadinessChecklist({ clientId, readiness }: ReadinessChecklistProps) {
  return (
    <section aria-labelledby="readiness-heading" className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="readiness-heading" className="text-sm font-semibold text-foreground">
          Ready for an SBR prediction?
        </h2>
        <span className={`text-xs ${readiness.canPredict ? 'text-success' : 'text-foreground/50'}`}>
          {readiness.canPredict ? 'Everything is in.' : `${readiness.waitingFor.length} to go`}
        </span>
      </div>
      <ul className="mt-3 divide-y divide-border">
        {readiness.items.map((item) => (
          <ChecklistRow key={item.key} clientId={clientId} item={item} />
        ))}
      </ul>
    </section>
  )
}

function ChecklistRow({ clientId, item }: { clientId: string; item: ReadinessItem }) {
  const router = useRouter()
  const [busy, setBusy] = useState<'review' | 'run' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showNotes, setShowNotes] = useState(item.status === 'needs_review' && !item.review)

  async function post(kind: 'review' | 'run') {
    setBusy(kind)
    setError(null)
    try {
      const res = await fetch(
        kind === 'review'
          ? `/api/admin/clients/${clientId}/readiness/review`
          : `/api/admin/clients/${clientId}/analysis/run`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: kind === 'review' ? JSON.stringify({ item: item.key }) : undefined,
        },
      )
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string }
        setError(payload.error ?? 'That did not work. Try again.')
        return
      }
      router.refresh()
    } catch {
      setError('Could not reach the server.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex items-start gap-2.5">
        <StatusIcon item={item} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-medium text-foreground">{item.label}</span>
            <Badge variant={item.review ? 'success' : BADGE[item.status]}>
              {item.review ? 'Reviewed' : STATUS_LABEL[item.status]}
            </Badge>
          </div>
          <p className="mt-0.5 text-xs text-foreground/60">{item.detail}</p>
          {item.review && (
            <p className="mt-0.5 text-xs text-foreground/40">
              Reviewed by {item.review.by}, {formatDate(item.review.at)}
            </p>
          )}

          {item.notes.length > 0 && (
            <div className="mt-1.5">
              <button
                type="button"
                onClick={() => setShowNotes((v) => !v)}
                className="text-xs text-accent hover:underline"
                aria-expanded={showNotes}
              >
                {showNotes ? 'Hide' : 'Show'} {item.notes.length} thing{item.notes.length === 1 ? '' : 's'} to check
              </button>
              {showNotes && (
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-foreground/70">
                  {item.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {item.canRunNow && (
            <Button type="button" size="sm" variant="accent" loading={busy === 'run'} onClick={() => post('run')}>
              Run now
            </Button>
          )}
          {item.status === 'needs_review' && !item.review && (
            <Button type="button" size="sm" variant="ghost" loading={busy === 'review'} onClick={() => post('review')}>
              Mark as reviewed
            </Button>
          )}
          <Link href={item.href} className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
            Open
            <ArrowRight className="h-3 w-3" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </li>
  )
}
