'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertCircle, CheckCircle2 } from 'lucide-react'
import { Spinner } from '@/components/ui/Spinner'
import type { JobStatusResponse } from '@/app/api/admin/clients/[id]/financials-comparison/status/[jobId]/route'

const POLL_INTERVAL_MS = 4000

interface Props {
  clientId: string
  /** The comparison job running when the page was rendered. */
  jobId: string
  mode: 'full' | 'compare'
  startedAt: string
}

type Phase = 'running' | 'done' | 'failed'

/**
 * A banner on the client page while a financials comparison runs in the
 * background (it is started from the comparison page and takes minutes).
 * Follows the job until it finishes, then says so and links to the result.
 */
export function ComparisonJobStatus({ clientId, jobId, mode, startedAt }: Props) {
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>('running')
  const [error, setError] = useState<string | null>(null)
  const [minutes, setMinutes] = useState(() => minutesSince(startedAt))

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let stopped = false

    // Recursive setTimeout, so a slow answer never overlaps the next poll.
    async function poll() {
      try {
        const res = await fetch(
          `/api/admin/clients/${clientId}/financials-comparison/status/${jobId}`,
          { cache: 'no-store' },
        )
        if (stopped) return
        const data = (await res.json()) as JobStatusResponse & { error?: string }
        if (res.ok && data.status === 'done') {
          setPhase('done')
          router.refresh()
          return
        }
        if (!res.ok || data.status === 'failed') {
          setError(data.error ?? 'The comparison failed.')
          setPhase('failed')
          return
        }
      } catch {
        // A dropped poll is not a failed job: try again on the next tick.
        if (stopped) return
      }
      setMinutes(minutesSince(startedAt))
      timer = setTimeout(poll, POLL_INTERVAL_MS)
    }

    timer = setTimeout(poll, POLL_INTERVAL_MS)
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [clientId, jobId, startedAt, router])

  const href = `/clients/${clientId}/financials-comparison`
  const what = mode === 'full' ? 'Reading the financial statement PDFs and comparing years' : 'Comparing years'

  if (phase === 'done') {
    return (
      <div role="status" className="mb-6 flex items-center gap-3 rounded-xl border border-success/30 bg-success/10 p-4 text-sm">
        <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
        <p className="flex-1 text-foreground/80">The financials comparison has finished.</p>
        <Link href={href} className="text-xs font-medium text-accent hover:underline">
          View comparison
        </Link>
      </div>
    )
  }

  if (phase === 'failed') {
    return (
      <div role="alert" className="mb-6 flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
        <p className="flex-1 text-foreground/80">
          <span className="font-medium text-foreground">The financials comparison failed.</span>{' '}
          {error}
        </p>
        <Link href={href} className="text-xs font-medium text-accent hover:underline">
          Open comparison
        </Link>
      </div>
    )
  }

  return (
    <div role="status" className="mb-6 flex items-center gap-3 rounded-xl border border-accent/30 bg-accent/5 p-4 text-sm">
      <Spinner size="sm" className="shrink-0" />
      <p className="flex-1 text-foreground/80">
        <span className="font-medium text-foreground">Financials comparison in progress.</span>{' '}
        {what} — started {minutes < 1 ? 'just now' : `${minutes} min ago`}. This usually takes
        3–5 minutes; you can keep working.
      </p>
      <Link href={href} className="shrink-0 text-xs font-medium text-accent hover:underline">
        View progress
      </Link>
    </div>
  )
}

function minutesSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000))
}
