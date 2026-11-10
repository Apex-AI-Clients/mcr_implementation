'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, ScanLine } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { parseAmount } from '@/lib/printed/amounts'
import { formatPrinted } from '@/lib/printed/csv'
import type { ComparisonCell } from '@/lib/printed/compare'
import type { PrintedAmount } from '@/lib/printed/types'

/**
 * Figures read from a scanned page by Claude (src/lib/scan): the crop of the
 * printed line, the figure as read, and a typed correction. The crop is made
 * on our server from the PDF in our storage, on request, and never kept.
 */

type ScanInfo = NonNullable<ComparisonCell['scan']>

const show = (v: PrintedAmount | undefined) => (v === undefined ? 'nothing' : formatPrinted(v))

export function ScanCrop({ clientId, scan }: { clientId: string; scan: ScanInfo }) {
  if (!scan.band) return <p className="text-[11px] text-foreground/50">No crop: the line&apos;s place on page {scan.page} was not read.</p>
  const q = new URLSearchParams({ documentId: scan.documentId, page: String(scan.page), top: scan.band[0].toFixed(4), bottom: scan.band[1].toFixed(4) })
  return (
    // A crop made on request from our own storage: next/image would cache it.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/api/admin/clients/${clientId}/scan-crop?${q}`}
      alt={`The printed line on page ${scan.page} of the scan`}
      className="max-h-24 w-full rounded border border-border/60 bg-white object-contain object-left"
    />
  )
}

/** The figure as Claude read it from the scan, and a way to correct it (typed in; who and when are kept). */
export function ScanCorrection({ clientId, scan }: { clientId: string; scan: ScanInfo }) {
  const router = useRouter()
  const [typed, setTyped] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function saveCorrection() {
    const parsed = parseAmount(typed.trim())
    if (!parsed || parsed.kind !== 'amount') return setError('Type the figure as printed, e.g. 1,234, (1,234) or -.')
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/clients/${clientId}/scan-choices`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ documentId: scan.documentId, rowKey: scan.key, column: scan.column, source: 'typed', value: parsed.value }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Failed to save')
      setTyped('')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-1.5 text-xs">
      {scan.status === 'chosen' ? (
        <p className="text-foreground/70">
          Corrected by {scan.chosenBy}
          {scan.chosenAt ? ` on ${new Date(scan.chosenAt).toLocaleDateString('en-AU')}` : ''} (read from the scan as {show(scan.claude)}).
        </p>
      ) : (
        <p className="text-foreground/70">Read from the scan as {show(scan.claude)}. If the printed line shows something else, type the figure.</p>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder="Correct figure"
          aria-label="The figure as printed"
          className="w-36 rounded border border-border/60 bg-input-bg px-2 py-1 tabular-nums text-foreground"
        />
        <Button size="sm" variant="ghost" loading={saving} disabled={saving || typed.trim() === ''} onClick={saveCorrection}>
          Save correction
        </Button>
        {error && <span className="text-destructive">{error}</span>}
      </div>
    </div>
  )
}

interface Job {
  /** The reading's own id: unique even if one file were being read twice. */
  id: string
  documentId: string
  stage: string | null
  done: number
  total: number
}

/** Seconds with no reading seen before the box offers to start it by hand. */
const START_GRACE_MS = 20_000

/** How far a file's scanning is (0–100): finding the statement pages is the first third, reading them the rest. */
function percent(job: Job | undefined): number {
  if (!job || job.total === 0) return 3
  const part = Math.min(1, job.done / job.total)
  return Math.round(job.stage === 'reading' ? 33 + part * 67 : part * 33)
}

function step(job: Job | undefined): string {
  if (!job) return 'Starting…'
  if (job.stage === 'selecting') return `Finding the statement pages (page ${Math.min(job.done + 1, job.total)} of ${job.total})`
  if (job.stage === 'reading') return `Reading the statements (page ${Math.min(job.done + 1, job.total)} of ${job.total})`
  return 'Starting…'
}

/**
 * Statements uploaded as scans, being read (src/lib/scan): what is happening,
 * in plain words, with progress per file. Starts the scanning once per page
 * load; if no scanning has started after a little while (it failed to start,
 * or stopped), offers "Start scanning". Refreshes the page when every file is
 * done.
 */
export function ScanProgress({
  clientId,
  files,
  pollMs = 3000,
  graceMs = START_GRACE_MS,
}: {
  clientId: string
  files: { documentId: string; filename: string }[]
  pollMs?: number
  graceMs?: number
}) {
  const router = useRouter()
  const [jobs, setJobs] = useState<Job[]>([])
  const [stalled, setStalled] = useState(false)
  const [starting, setStarting] = useState(false)
  const started = useRef(false)
  // The polling loop must not restart when the router object does.
  const routerRef = useRef(router)
  routerRef.current = router
  const pending = files.length > 0

  async function start() {
    setStarting(true)
    setStalled(false)
    try {
      await fetch(`/api/admin/clients/${clientId}/scan-read`, { method: 'POST' })
    } catch {
      setStalled(true)
    } finally {
      setStarting(false)
    }
  }

  useEffect(() => {
    if (!pending) return
    let stopped = false
    let seenRunning = false
    let lastSeen = Date.now()
    // Once: React runs this effect twice in development, and the server refuses a second reading anyway (0045).
    if (!started.current) {
      started.current = true
      void start()
    }
    const poll = async () => {
      try {
        const res = await fetch(`/api/admin/clients/${clientId}/scan-jobs`)
        const body = (await res.json()) as { jobs?: Job[] }
        if (stopped) return
        const running = body.jobs ?? []
        setJobs(running)
        if (running.length) {
          seenRunning = true
          lastSeen = Date.now()
          setStalled(false)
        } else if (seenRunning) {
          // Every file is done: show the figures.
          return routerRef.current.refresh()
        } else if (Date.now() - lastSeen > graceMs) {
          setStalled(true)
        }
      } catch {
        // Try again on the next tick.
      }
      if (!stopped) setTimeout(poll, pollMs)
    }
    void poll()
    return () => {
      stopped = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- start() only reads clientId
  }, [clientId, pending, pollMs, graceMs])

  if (!pending) return null
  const byDoc = new Map(jobs.map((j) => [j.documentId, j]))
  return (
    <section className="no-print rounded-lg border border-accent/40 bg-accent/5 p-4" aria-live="polite" aria-label="Scanning documents">
      <div className="flex items-start gap-3">
        {stalled ? (
          <ScanLine className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden />
        ) : (
          <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-accent" aria-hidden />
        )}
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              {stalled ? 'Scanning has not started' : `Scanning ${files.length === 1 ? 'document' : `${files.length} documents`}`}
            </h2>
            <p className="mt-0.5 text-xs text-foreground/70">
              {stalled
                ? 'These statements were uploaded as scans (pictures of the pages) and still need to be read.'
                : 'These statements were uploaded as scans (pictures of the pages), so we are reading them now. This usually takes a minute or two. You can leave this page: the figures appear here when it is done.'}
            </p>
          </div>
          <ul className="space-y-2">
            {files.map((f) => {
              const job = byDoc.get(f.documentId)
              return (
                <li key={f.documentId} className="space-y-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs">
                    <span className="font-medium text-foreground">{f.filename}</span>
                    <span className="text-foreground/60">{stalled && !job ? 'Waiting' : step(job)}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-border/60" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent(job)} aria-label={`${f.filename}: scanning`}>
                    <div className="h-full rounded-full bg-accent transition-all duration-700" style={{ width: `${percent(job)}%` }} />
                  </div>
                </li>
              )
            })}
          </ul>
          {stalled && (
            <Button size="sm" variant="primary" onClick={start} loading={starting} disabled={starting}>
              Start scanning
            </Button>
          )}
        </div>
      </div>
    </section>
  )
}
