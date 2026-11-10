'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, FileText, Loader2, ScanLine } from 'lucide-react'
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

/** Rough timings, for "about N minutes left": a page title on our server, a statement page read by Claude. */
const SECONDS_PER_TITLE = 0.5
const SECONDS_PER_STATEMENT_PAGE = 22
/** A file not started yet: a typical annual pack (25 pages, 5 of them statements). */
const SECONDS_PER_WAITING_FILE = 25 * SECONDS_PER_TITLE + 5 * SECONDS_PER_STATEMENT_PAGE

/** How far a file is (0–100): finding the statement pages is quick (the first fifth); reading them is most of the wait. */
function percent(job: Job | undefined): number {
  if (!job || job.total === 0) return 2
  const part = Math.min(1, job.done / job.total)
  return Math.max(2, Math.round(job.stage === 'reading' ? 20 + part * 80 : part * 20))
}

function secondsLeft(job: Job | undefined): number {
  if (!job || job.total === 0) return SECONDS_PER_WAITING_FILE
  const left = Math.max(0, job.total - job.done)
  return job.stage === 'reading' ? left * SECONDS_PER_STATEMENT_PAGE : left * SECONDS_PER_TITLE + 5 * SECONDS_PER_STATEMENT_PAGE
}

export function timeLeft(seconds: number): string {
  if (seconds < 50) return 'Less than a minute left'
  const minutes = Math.round(seconds / 60)
  return minutes <= 1 ? 'About a minute left' : `About ${minutes} minutes left`
}

type FileState = 'starting' | 'waiting' | 'finding' | 'reading'

function fileState(job: Job | undefined, anotherRunning: boolean): FileState {
  if (!job) return anotherRunning ? 'waiting' : 'starting'
  return job.stage === 'reading' ? 'reading' : job.stage === 'selecting' ? 'finding' : 'starting'
}

function Step({ n, label, state }: { n: number; label: string; state: 'todo' | 'now' | 'done' }) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${state === 'todo' ? 'text-foreground/40' : state === 'now' ? 'font-medium text-foreground' : 'text-success'}`}>
      {state === 'done' ? (
        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
      ) : (
        <span
          className={`inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-[9px] font-semibold ${state === 'now' ? 'bg-accent text-white' : 'border border-foreground/25'}`}
          aria-hidden
        >
          {n}
        </span>
      )}
      {label}
      {state === 'done' && <span className="sr-only"> (done)</span>}
    </span>
  )
}

/**
 * Statements uploaded as scans, being read (src/lib/scan): what is happening,
 * in plain words, how long is left, and each file's progress. The reading
 * runs on the server: leaving the page does not stop it, and coming back
 * shows it where it is (it is never started again while it runs). Starts the
 * reading once per page load; if none has started after a little while,
 * offers "Start scanning". When every file is done, says so and refreshes.
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
  const [finished, setFinished] = useState(false)
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
          // Every file is done: say so, then show the figures.
          setFinished(true)
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
  const overall = Math.round(files.reduce((sum, f) => sum + percent(byDoc.get(f.documentId)), 0) / files.length)
  const left = files.reduce((sum, f) => sum + secondsLeft(byDoc.get(f.documentId)), 0)
  const count = files.length === 1 ? '1 document' : `${files.length} documents`

  if (stalled && !finished) {
    return (
      <section className="no-print rounded-xl border border-warning/40 bg-card p-4" role="status" aria-label="Scanned statements waiting to be read">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-warning/15">
            <ScanLine className="h-5 w-5 text-warning" aria-hidden />
          </span>
          <div className="min-w-0 flex-1 space-y-2">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Scanning has not started</h2>
              <p className="mt-0.5 text-xs text-foreground/70">
                {count} uploaded as scans (pictures of the pages) still {files.length === 1 ? 'needs' : 'need'} to be read.
              </p>
            </div>
            <Button size="sm" variant="primary" onClick={start} loading={starting} disabled={starting}>
              Start scanning
            </Button>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section
      className="no-print overflow-hidden rounded-xl border border-accent/30 bg-card shadow-sm"
      role="status"
      aria-live="polite"
      aria-label={finished ? 'Scanned statements read' : 'Reading scanned statements'}
    >
      <div className="h-1 w-full bg-accent/10" aria-hidden>
        <div className={`h-full transition-all duration-700 ${finished ? 'bg-success' : 'bg-accent'}`} style={{ width: `${finished ? 100 : overall}%` }} />
      </div>
      <div className="space-y-4 p-4">
        <div className="flex items-start gap-3">
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${finished ? 'bg-success/15' : 'bg-accent/10'}`}>
            {finished ? <CheckCircle2 className="h-5 w-5 text-success" aria-hidden /> : <ScanLine className="h-5 w-5 animate-pulse text-accent" aria-hidden />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h2 className="text-sm font-semibold text-foreground">{finished ? 'Done — updating the figures…' : 'Reading your scanned statements'}</h2>
              {!finished && (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-accent">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  {timeLeft(left)}
                </span>
              )}
            </div>
            {!finished && (
              <p className="mt-1 text-xs leading-relaxed text-foreground/70">
                {count} came as scans (pictures of the pages), so the figures are being read for you. It keeps going in the background: you can
                leave this page and come back. The figures appear here as soon as it is done.
              </p>
            )}
          </div>
        </div>

        {!finished && (
          <ul className="space-y-2">
            {files.map((f) => {
              const job = byDoc.get(f.documentId)
              const state = fileState(job, jobs.length > 0)
              const pct = percent(job)
              return (
                <li key={f.documentId} className="rounded-lg border border-border/60 bg-surface/60 px-3 py-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-2 text-xs font-medium text-foreground">
                      <FileText className="h-4 w-4 shrink-0 text-foreground/50" aria-hidden />
                      <span className="truncate">{f.filename}</span>
                    </span>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        state === 'waiting' ? 'bg-foreground/5 text-foreground/55' : 'bg-accent/10 text-accent'
                      }`}
                    >
                      {state === 'waiting' ? 'Waiting its turn' : state === 'starting' ? 'Starting…' : `${pct}%`}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
                    <Step n={1} label={state === 'finding' && job ? `Finding the statement pages (page ${Math.min(job.done + 1, job.total)} of ${job.total})` : 'Find the statement pages'} state={state === 'finding' ? 'now' : state === 'reading' ? 'done' : 'todo'} />
                    <Step n={2} label={state === 'reading' && job ? `Reading the figures (page ${Math.min(job.done + 1, job.total)} of ${job.total})` : 'Read the figures'} state={state === 'reading' ? 'now' : 'todo'} />
                  </div>
                  <div
                    className="mt-2 h-1.5 overflow-hidden rounded-full bg-foreground/10"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={pct}
                    aria-label={`${f.filename}: scanning`}
                  >
                    <div className={`h-full rounded-full transition-all duration-700 ${state === 'waiting' ? 'bg-foreground/20' : 'bg-accent'}`} style={{ width: `${pct}%` }} />
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}
