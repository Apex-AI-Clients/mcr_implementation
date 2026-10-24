'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Circle, Clock, Loader2, XCircle } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { STATUS_LABEL, type Readiness, type ReadinessItem, type ReadinessStatus } from '@/lib/sbr/readiness'

/** How often to look again while something is processing. */
const POLL_INTERVAL_MS = 4000

interface ReadinessChecklistProps {
  clientId: string
  readiness: Readiness
}

const BADGE: Record<ReadinessStatus, 'muted' | 'accent' | 'success' | 'destructive'> = {
  not_uploaded: 'muted',
  not_started: 'muted',
  processing: 'accent',
  ready: 'success',
  failed: 'destructive',
  needs_review: 'destructive',
}

function StatusIcon({ status }: { status: ReadinessStatus }) {
  if (status === 'ready') return <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
  if (status === 'processing') return <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent" aria-hidden="true" />
  if (status === 'not_started') return <Clock className="h-4 w-4 shrink-0 text-foreground/40" aria-hidden="true" />
  if (status === 'failed' || status === 'needs_review') return <XCircle className="h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
  return <Circle className="h-4 w-4 shrink-0 text-foreground/25" aria-hidden="true" />
}

/** What the rest of the page was rendered from, for telling when it is out of date. */
function signature(readiness: Readiness): string {
  return [
    readiness.canPredict,
    ...readiness.items.map((i) => `${i.key}:${i.status}:${i.canRunNow}:${i.detail ?? ''}`),
  ].join('|')
}

function isReadiness(value: unknown): value is Readiness {
  return typeof value === 'object' && value !== null && Array.isArray((value as Readiness).items)
}

/**
 * What the SBR outcome prediction needs, item by item: Not uploaded, Not run
 * yet, Processing, Ready or Failed. Status only: nothing here asks staff to
 * review or sign anything off. Not run yet offers Run now.
 *
 * The page renders this once, so it keeps itself current:
 *  - while anything is Processing, it asks again every few seconds;
 *  - whenever the page is shown again (the back button, a restored tab, the
 *    window coming back into view) it asks once, because what is on screen is
 *    whatever was rendered when the page was first opened.
 * When the answer differs from what the page was rendered with, the page is
 * refreshed, so the Predict button and the rest catch up too.
 */
export function ReadinessChecklist({ clientId, readiness: fromServer }: ReadinessChecklistProps) {
  const router = useRouter()
  // The latest word: the server's render, until a check says otherwise.
  const [state, setState] = useState({ from: fromServer, readiness: fromServer })
  if (state.from !== fromServer) setState({ from: fromServer, readiness: fromServer })
  const { readiness } = state

  const rendered = useRef(signature(fromServer))
  useEffect(() => {
    rendered.current = signature(fromServer)
  }, [fromServer])

  const inFlight = useRef(false)
  const check = useCallback(async () => {
    // One at a time: a slow answer never overlaps the next tick.
    if (inFlight.current) return
    inFlight.current = true
    try {
      const res = await fetch(`/api/admin/clients/${clientId}/readiness`, { cache: 'no-store' })
      if (!res.ok) return
      const fresh: unknown = await res.json()
      if (!isReadiness(fresh)) return
      setState((prev) => ({ ...prev, readiness: fresh }))
      const sig = signature(fresh)
      if (sig !== rendered.current) {
        rendered.current = sig
        router.refresh()
      }
    } catch {
      // A dropped check changes nothing on screen; the next one tries again.
    } finally {
      inFlight.current = false
    }
  }, [clientId, router])

  // Once on arrival (including back/forward, which restores an old render),
  // and again whenever the page is shown after being hidden.
  useEffect(() => {
    void check()
    function onPageShow(event: PageTransitionEvent) {
      if (event.persisted) void check()
    }
    function onVisible() {
      if (document.visibilityState === 'visible') void check()
    }
    window.addEventListener('pageshow', onPageShow)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('pageshow', onPageShow)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [check])

  const processing = readiness.items.some((i) => i.status === 'processing')
  useEffect(() => {
    if (!processing) return
    const timer = setInterval(() => void check(), POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [processing, check])

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
          <ChecklistRow key={item.key} clientId={clientId} item={item} onStarted={check} />
        ))}
      </ul>
    </section>
  )
}

function ChecklistRow({
  clientId,
  item,
  onStarted,
}: {
  clientId: string
  item: ReadinessItem
  onStarted: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function runNow() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/clients/${clientId}/analysis/run`, { method: 'POST' })
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string }
        setError(payload.error ?? 'That did not work. Try again.')
        return
      }
      // Read it back: it now shows Processing, the page refreshes to match,
      // and the checklist follows the run from there.
      await onStarted()
    } catch {
      setError('Could not reach the server.')
    } finally {
      setBusy(false)
    }
  }

  // Items still to upload point back at this page, where the upload is: no
  // link to where you already are.
  const links = item.href !== `/clients/${clientId}`

  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex items-start gap-2.5">
        <StatusIcon status={item.status} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {links ? (
              <Link href={item.href} className="text-sm font-medium text-accent hover:underline">
                {item.label}
              </Link>
            ) : (
              <span className="text-sm font-medium text-foreground">{item.label}</span>
            )}
            <Badge variant={BADGE[item.status]}>{STATUS_LABEL[item.status]}</Badge>
          </div>
          {item.detail && <p className="mt-0.5 text-xs text-foreground/60">{item.detail}</p>}
          {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
        </div>

        {item.canRunNow && (
          <Button type="button" size="sm" variant="accent" loading={busy} onClick={runNow} className="shrink-0">
            Run now
          </Button>
        )}
      </div>
    </li>
  )
}
