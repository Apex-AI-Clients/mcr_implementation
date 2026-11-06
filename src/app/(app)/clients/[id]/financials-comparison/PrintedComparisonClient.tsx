'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Download, ExternalLink, FileText, RefreshCw, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { ExportPdfButton } from '@/components/admin/ExportPdfButton'
import { NeedsReviewBanner } from '@/components/admin/financials/NeedsReviewBanner'
import { PrintedComparisonTable, type SelectedFigure } from '@/components/admin/financials/PrintedComparisonTable'
import { HeadlineTiles } from '@/components/admin/financials/HeadlineTiles'
import { ComparisonSummaryCard } from '@/components/admin/financials/ComparisonSummaryCard'
import { ScanChecksPanel, ScanChooser, ScanCrop, ScanProgress } from '@/components/admin/financials/ScanFigures'
import type { MappingEntry } from '@/lib/printed/mapping'
import type { Suggestions } from '@/lib/printed/dictionary'
import { exportsLocked, reviewLine, type FiguresChecked } from '@/lib/financials/hardChecks'
import { columnTitle, comparisonCsv, formatPrinted } from '@/lib/printed/csv'
import type { PossibleLine } from '@/lib/printed/autoMapping'
import type { Meaning } from '@/lib/printed/meanings'
import { printedHardChecks } from '@/lib/printed/review'
import type { PrintedComparison } from '@/lib/printed/compare'

interface Props {
  clientId: string
  /** The client page its links go under: /clients/{id} (SBR, the default) or /cvl/{id} (CVL). */
  basePath?: string
  clientName: string
  comparison: PrintedComparison
  /** The latest read: what the "I've checked these figures" tick covers. */
  builtAt: string | null
  initialFiguresChecked: FiguresChecked | null
  /** The lines staff confirmed (mapping.ts), and the suggestions shown until they do. */
  mapping: MappingEntry[]
  suggestions: Suggestions
  /** Lines that look like a key figure the dictionary did not match (autoMapping.ts). */
  possible?: Partial<Record<Meaning, PossibleLine[]>>
  /** Showing the years printed only as a comparative column. */
  earlierYears?: boolean
  /** The AI summary is on (AI_SUMMARIES_ENABLED and a key): show its card. */
  aiSummaryEnabled?: boolean
}

/**
 * The comparison page: the client's statements exactly as printed, years side
 * by side (src/lib/printed/compare.ts). No figure is calculated, renamed or
 * guessed; a printed total that does not add up shows Needs review and locks
 * the PDF and CSV until a staff member ticks that they checked it.
 */
export function PrintedComparisonClient({ clientId, basePath = `/clients/${clientId}`, clientName, comparison, builtAt, initialFiguresChecked, mapping, suggestions, possible = {}, earlierYears = false, aiSummaryEnabled = false }: Props) {
  const router = useRouter()
  const [figuresChecked, setFiguresChecked] = useState<FiguresChecked | null>(initialFiguresChecked)
  const [selected, setSelected] = useState<SelectedFigure | null>(null)
  const [rereading, setRereading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const failures = printedHardChecks(comparison)
  const exportLock = exportsLocked(failures, builtAt, figuresChecked)
    ? `Needs review: tick "I've checked these figures against the source documents" first.`
    : null
  const reviewedBy = reviewLine(failures, builtAt, figuresChecked)
  const hasTables = comparison.tables.length > 0

  async function reread() {
    setRereading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/clients/${clientId}/printed-reads`, { method: 'POST' })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Failed to read the PDFs')
      setSelected(null)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to read the PDFs')
    } finally {
      setRereading(false)
    }
  }

  function exportCsv() {
    const csv = comparisonCsv({ clientName, comparison, reviewedBy })
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${clientName.replace(/[^a-z0-9-]+/gi, '_')}_financials_as_printed.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div id="financials-export-root" className="space-y-6">
      <div className="space-y-3">
        <Link href={basePath} className="no-print inline-flex items-center gap-1 text-xs text-foreground/50 hover:text-foreground transition-colors">
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to client
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Financial Statements — As Printed</h1>
            <p className="text-sm text-foreground/60 mt-0.5">{clientName}</p>
            <p className="text-xs text-foreground/40 mt-1">
              Every figure as printed in the uploaded statements, read from the PDFs. Click a figure to see where it is printed.
            </p>
          </div>
          <div className="no-print flex flex-wrap items-center gap-2">
            {hasTables && (
              <>
                <ExportPdfButton targetId="financials-export-root" fileName={`${clientName}_financials_as_printed`} lockedReason={exportLock} />
                <Button variant="ghost" size="sm" onClick={exportCsv} disabled={exportLock !== null} title={exportLock ?? undefined}>
                  <Download className="h-3.5 w-3.5" />
                  Export CSV
                </Button>
              </>
            )}
            {/* Re-reads every PDF and rebuilds the comparison (seconds). Uploads and deletes do this on their own. */}
            <Button variant="ghost" size="sm" onClick={reread} loading={rereading} disabled={rereading} title="Read the PDFs again and rebuild the comparison">
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </Button>
          </div>
        </div>
        {error && <p className="no-print text-xs text-destructive">{error}</p>}
      </div>

      <ScanProgress clientId={clientId} files={comparison.documents.filter((d) => d.status === 'scan_pending').map((d) => ({ documentId: d.documentId, filename: d.filename }))} />

      <NeedsReviewBanner clientId={clientId} failures={failures} generatedAt={builtAt} checked={figuresChecked} onChecked={setFiguresChecked} />

      <ScanChecksPanel clientId={clientId} comparison={comparison} />

      {!hasTables ? (
        <p className="rounded-lg border border-border/60 bg-surface/60 p-4 text-sm text-foreground/70">
          {comparison.documents.length === 0
            ? 'No financial statements have been uploaded yet.'
            : 'No profit and loss or balance sheet could be read from the uploaded files. See the files below.'}
        </p>
      ) : (
        <>
          {comparison.annualYears < 2 && (
            <p className="text-xs text-foreground/60">Only one financial year is on file so far: upload the earlier years to compare.</p>
          )}
          <HeadlineTiles clientId={clientId} basePath={basePath} comparison={comparison} mapping={mapping} suggestions={suggestions} possible={possible} />
          {aiSummaryEnabled && (
            <ComparisonSummaryCard
              clientId={clientId}
              inputsKey={`${builtAt ?? ''}|${figuresChecked?.fingerprint ?? ''}|${mapping.map((m) => `${m.meaning}:${m.rowKey}:${m.confirmedAt}`).join(',')}`}
            />
          )}
          {(earlierYears || comparison.hiddenComparativeYears.length > 0) && (
            <label className="no-print flex items-center gap-2 text-xs text-foreground/70">
              <input
                type="checkbox"
                checked={earlierYears}
                onChange={(e) => router.push(e.target.checked ? `?earlier=1` : '?')}
                className="accent-accent"
              />
              Show earlier years from comparative columns
              {!earlierYears && (
                <span className="text-foreground/45">({comparison.hiddenComparativeYears.map((y) => `FY${y}`).join(', ')}: printed only as the previous year in a later report)</span>
              )}
            </label>
          )}
          {selected && <SourcePanel clientId={clientId} figure={selected} onClose={() => setSelected(null)} />}
          {comparison.tables.map((table) => (
            <PrintedComparisonTable key={table.kind} table={table} columns={comparison.columns} selected={selected} onSelect={setSelected} />
          ))}
        </>
      )}

      <FilesPanel comparison={comparison} />
    </div>
  )
}

/** Where a clicked figure is printed: the file, page, column and line, and the PDF itself. */
function SourcePanel({ clientId, figure, onClose }: { clientId: string; figure: SelectedFigure; onClose: () => void }) {
  const { row, column, cell } = figure
  const [opening, setOpening] = useState(false)
  if (!cell.source) return null
  const source = cell.source

  async function openPdf() {
    setOpening(true)
    try {
      const res = await fetch(`/api/admin/documents/${source.documentId}/download`)
      const body = await res.json()
      if (res.ok && body.url) window.open(`${body.url}#page=${source.page}`, '_blank', 'noopener,noreferrer')
    } finally {
      setOpening(false)
    }
  }

  return (
    <div className="no-print rounded-lg border border-accent/40 bg-accent/5 p-3 text-xs">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="font-semibold text-foreground">
            {row.label || '(no label)'} · {columnTitle(column).title}: {formatPrinted(cell.value)}
          </p>
          <p className="text-foreground/70">
            <FileText className="mr-1 inline h-3.5 w-3.5" aria-hidden />
            {source.filename}, page {source.page}, column &ldquo;{source.header}&rdquo;
          </p>
          <p className="font-mono text-[11px] text-foreground/60">&ldquo;{source.text}&rdquo;</p>
          {cell.scan && (
            <div className="space-y-1.5 pt-1">
              <p className="text-foreground/70">
                Read from a scan:{' '}
                {cell.scan.status === 'agree'
                  ? 'both readings agree.'
                  : cell.scan.status === 'chosen'
                    ? 'the readings differed; this figure was chosen.'
                    : cell.scan.status === 'single'
                      ? 'single reading — check it against the line below.'
                      : 'the two readings differ — choose the figure.'}
              </p>
              <ScanCrop clientId={clientId} scan={cell.scan} />
              <ScanChooser clientId={clientId} scan={cell.scan} />
            </div>
          )}
          {cell.restated.map((r, i) => (
            <p key={i} className="text-warning">
              Restated in {r.report.replace(/^the /, '')}: {formatPrinted(r.value)} ({r.source.filename}, page {r.source.page}: &ldquo;{r.source.text}&rdquo;)
            </p>
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="sm" onClick={openPdf} loading={opening}>
            <ExternalLink className="h-3.5 w-3.5" />
            Open PDF
          </Button>
          <button type="button" onClick={onClose} className="rounded p-1 text-foreground/50 hover:text-foreground" aria-label="Close">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}

/** Each uploaded file: what was read from it, or exactly why not. */
function FilesPanel({ comparison }: { comparison: PrintedComparison }) {
  if (comparison.documents.length === 0) return null
  return (
    <section className="no-print">
      <h2 className="text-sm font-semibold text-foreground mb-2">Files read</h2>
      <ul className="divide-y divide-border/40 rounded-lg border border-border/60 text-xs">
        {comparison.documents.map((d) => (
          <li key={d.documentId} className="px-3 py-2">
            <p className="font-medium text-foreground">{d.filename}</p>
            {d.found && <p className="text-foreground/60">{d.found}</p>}
            {d.message && <p className={d.status === 'read' && !d.issues.length ? 'text-foreground/50' : 'text-destructive'}>{d.message}</p>}
            {d.scan && <ScanPages scan={d.scan} />}
            {d.issues.filter((i) => i.text).map((i, n) => (
              <p key={n} className="font-mono text-[11px] text-foreground/50">
                Page {i.page}: &ldquo;{i.text}&rdquo;
              </p>
            ))}
          </li>
        ))}
      </ul>
    </section>
  )
}

/** A file with scanned pages: which pages are scans, which were read as statements, which skipped and why. */
function ScanPages({ scan }: { scan: NonNullable<PrintedComparison['documents'][number]['scan']> }) {
  const scanned = scan.pages.filter((p) => p.scanned)
  const read = scanned.filter((p) => p.role === 'statement')
  const skipped = scanned.filter((p) => p.role === 'skipped')
  const list = (pages: typeof scanned) => pages.map((p) => p.page).join(', ')
  return (
    <div className="mt-1 space-y-0.5 text-foreground/60">
      <p>
        Scanned pages: {list(scanned)}
        {scan.state === 'pending' ? ' (being read)' : ''}.
      </p>
      {read.length > 0 && <p>Read as statements: {read.map((p) => `${p.page} (${p.note ?? 'statement'})`).join(', ')}.</p>}
      {skipped.length > 0 && (
        <details>
          <summary className="cursor-pointer">Skipped: {list(skipped)}</summary>
          <ul className="mt-0.5 space-y-0.5 pl-3">
            {skipped.map((p) => (
              <li key={p.page}>
                Page {p.page}: {p.note}
              </li>
            ))}
          </ul>
        </details>
      )}
      {scan.singleReading && <p className="text-warning">Read by one reader only: every figure is a single reading — check them.</p>}
      <p className="text-foreground/50">A scan is read by two readers and checked by staff. The accountant&apos;s digital export (a PDF from their software) is always exact: ask for it.</p>
    </div>
  )
}
