'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ScanLine } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { parseAmount } from '@/lib/printed/amounts'
import { columnTitle, formatPrinted } from '@/lib/printed/csv'
import type { ComparisonCell, ComparisonColumn, ComparisonRow, PrintedComparison } from '@/lib/printed/compare'
import type { PrintedAmount } from '@/lib/printed/types'

/**
 * Figures read from a scanned page (src/lib/scan): the crop of the printed
 * line, both readings, and the choice where they differ. The crop is made on
 * our server from the PDF in our storage, on request, and never kept.
 */

type ScanInfo = NonNullable<ComparisonCell['scan']>

const show = (v: PrintedAmount | undefined) => (v === undefined ? 'not read' : formatPrinted(v))

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

/** Both readings, and (where they differ, or for a single reading) the choice: one of them, or the figure typed in. */
export function ScanChooser({ clientId, scan, onSaved }: { clientId: string; scan: ScanInfo; onSaved?: () => void }) {
  const router = useRouter()
  const [typed, setTyped] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(source: 'tesseract' | 'claude' | 'typed', value: number | null) {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/clients/${clientId}/scan-choices`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ documentId: scan.documentId, rowKey: scan.key, column: scan.column, source, value }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Failed to save')
      onSaved?.()
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  function saveTyped() {
    const parsed = parseAmount(typed.trim())
    if (!parsed || parsed.kind !== 'amount') return setError('Type the figure as printed, e.g. 1,234, (1,234) or -.')
    void save('typed', parsed.value)
  }

  const reading = (name: string, source: 'tesseract' | 'claude', v: PrintedAmount | undefined) => (
    <div className="flex items-center justify-between gap-2 rounded border border-border/50 px-2 py-1">
      <span className="text-foreground/60">{name}</span>
      <span className="font-semibold tabular-nums text-foreground">{show(v)}</span>
      {scan.status !== 'agree' && v !== undefined && typeof v !== 'string' && (
        <Button size="sm" variant="ghost" loading={saving} disabled={saving} onClick={() => save(source, v)}>
          Use this
        </Button>
      )}
    </div>
  )

  return (
    <div className="space-y-1.5 text-xs">
      <div className="grid gap-1.5 sm:grid-cols-2">
        {reading('Tesseract (our server)', 'tesseract', scan.ocr)}
        {reading('Claude (second reading)', 'claude', scan.claude)}
      </div>
      {scan.status === 'chosen' && (
        <p className="text-success">
          Chosen by {scan.chosenBy}
          {scan.chosenAt ? `, ${new Date(scan.chosenAt).toLocaleDateString('en-AU')}` : ''}.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder="Or type the figure"
          aria-label="The figure as printed"
          className="w-36 rounded border border-border/60 bg-input-bg px-2 py-1 tabular-nums text-foreground"
        />
        <Button size="sm" variant="ghost" loading={saving} disabled={saving || typed.trim() === ''} onClick={saveTyped}>
          Save
        </Button>
        {error && <span className="text-destructive">{error}</span>}
      </div>
    </div>
  )
}

/** Every scanned figure the readings disagree on, with its crop: the comparison stays "Needs review" until each is chosen. */
export function ScanChecksPanel({ clientId, comparison }: { clientId: string; comparison: PrintedComparison }) {
  const items: { row: ComparisonRow; column: ComparisonColumn; scan: ScanInfo }[] = []
  for (const table of comparison.tables) {
    for (const row of table.rows) {
      row.cells.forEach((cell, i) => {
        if (cell.scan?.status === 'disagree') items.push({ row, column: comparison.columns[i], scan: cell.scan })
      })
    }
  }
  if (items.length === 0) return null
  return (
    <section className="no-print rounded-lg border border-warning/40 bg-warning/5 p-3">
      <h2 className="text-sm font-semibold text-foreground">
        {items.length} scanned figure{items.length === 1 ? '' : 's'} to check
      </h2>
      <p className="mt-0.5 text-xs text-foreground/60">
        The two readings of the scan differ (or one of them missed the line). Look at the printed line and choose the figure, or type it. The comparison stays
        &ldquo;Needs review&rdquo; until every one is chosen.
      </p>
      <ul className="mt-3 space-y-3">
        {items.map(({ row, column, scan }) => (
          <li key={`${scan.key}#${scan.column}#${column.key}`} className="space-y-1.5 rounded border border-border/60 bg-card p-2">
            <p className="text-xs font-medium text-foreground">
              {row.label || '(no label)'} · {columnTitle(column).title} · page {scan.page}
            </p>
            <ScanCrop clientId={clientId} scan={scan} />
            <ScanChooser clientId={clientId} scan={scan} />
          </li>
        ))}
      </ul>
    </section>
  )
}

interface Job {
  documentId: string
  stage: string | null
  done: number
  total: number
}

/** While scanned pages are being read: progress, then the page refreshes itself. */
export function ScanProgress({ clientId, pending }: { clientId: string; pending: boolean }) {
  const router = useRouter()
  const [jobs, setJobs] = useState<Job[]>([])
  useEffect(() => {
    if (!pending) return
    let stopped = false
    let seenRunning = false
    const poll = async () => {
      try {
        const res = await fetch(`/api/admin/clients/${clientId}/scan-jobs`)
        const body = (await res.json()) as { jobs?: Job[] }
        if (stopped) return
        const running = body.jobs ?? []
        setJobs(running)
        if (running.length) seenRunning = true
        else if (seenRunning) return router.refresh()
      } catch {
        // Try again on the next tick.
      }
      if (!stopped) setTimeout(poll, 4000)
    }
    void poll()
    return () => {
      stopped = true
    }
  }, [clientId, pending, router])
  if (!pending) return null
  return (
    <div className="no-print flex items-center gap-2 rounded-lg border border-accent/40 bg-accent/5 p-3 text-xs text-foreground/80" aria-live="polite">
      <ScanLine className="h-4 w-4 text-accent" aria-hidden />
      {jobs.length === 0
        ? 'Scanned pages are waiting to be read.'
        : jobs.map((j) => (j.stage === 'selecting' ? `Finding the statement pages (${j.done} of ${j.total})…` : `Reading the statement pages (${j.done} of ${j.total})…`)).join(' ')}
    </div>
  )
}
