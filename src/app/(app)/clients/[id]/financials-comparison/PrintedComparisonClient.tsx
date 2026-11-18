'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Download, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { ExportPdfButton } from '@/components/admin/ExportPdfButton'
import { HeadlineFiguresTable } from '@/components/admin/financials/HeadlineFiguresTable'
import { ScanChecksPanel, ScanProgress, YearProofStrip } from '@/components/admin/financials/ScanFigures'
import type { MappingEntry } from '@/lib/printed/mapping'
import type { Suggestions } from '@/lib/printed/dictionary'
import type { PossibleLine } from '@/lib/printed/autoMapping'
import type { Meaning } from '@/lib/printed/meanings'
import type { PrintedComparison } from '@/lib/printed/compare'
import { headlineCsv, headlineRows, type IcaHeadline } from '@/lib/printed/headline'

interface Props {
  clientId: string
  /** The client page its links go under: /clients/{id} (SBR, the default) or /cvl/{id} (CVL). */
  basePath?: string
  clientName: string
  comparison: PrintedComparison
  /** The lines staff confirmed (mapping.ts), and the suggestions shown until they do. */
  mapping: MappingEntry[]
  suggestions: Suggestions
  /** Lines that look like a key figure the dictionary did not match (autoMapping.ts). */
  possible?: Partial<Record<Meaning, PossibleLine[]>>
  /** "ATO related debt – ICA", per column (ica/balanceAt.ts). */
  ica: IcaHeadline
  /** Showing the years printed only as a comparative column. */
  earlierYears?: boolean
}

/**
 * The financial statements comparison: the headline figures only, years side by side with the
 * current period as the last column (Gabby, 16 Nov 2026). Above them, each year's proof and the
 * scanned figures to check; nothing below. Every figure has its ⓘ (file, page, printed line).
 */
export function PrintedComparisonClient({ clientId, basePath = `/clients/${clientId}`, clientName, comparison, mapping, suggestions, possible = {}, ica, earlierYears = false }: Props) {
  const router = useRouter()
  const [rereading, setRereading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const hasTables = comparison.tables.length > 0
  const rows = headlineRows(comparison, mapping, suggestions, ica)

  async function reread() {
    setRereading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/clients/${clientId}/printed-reads`, { method: 'POST' })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Failed to read the PDFs')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to read the PDFs')
    } finally {
      setRereading(false)
    }
  }

  function exportCsv() {
    const csv = headlineCsv({ clientName, comparison, rows })
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${clientName.replace(/[^a-z0-9-]+/gi, '_')}_headline_figures.csv`
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
            <h1 className="text-xl font-semibold text-foreground">Financial Statements — Headline Figures</h1>
            <p className="text-sm text-foreground/60 mt-0.5">{clientName}</p>
            <p className="text-xs text-foreground/40 mt-1">
              Each figure as printed in the uploaded statements, years side by side. Hover the ⓘ to see the file, page and printed line.
            </p>
          </div>
          <div className="no-print flex flex-wrap items-center gap-2">
            {hasTables && (
              <>
                <ExportPdfButton targetId="financials-export-root" fileName={`${clientName}_headline_figures`} />
                <Button variant="ghost" size="sm" onClick={exportCsv}>
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
      <YearProofStrip comparison={comparison} />
      <ScanChecksPanel clientId={clientId} comparison={comparison} />

      {!hasTables ? (
        <p className="rounded-lg border border-border/60 bg-surface/60 p-4 text-sm text-foreground/70">
          {comparison.documents.length === 0 ? 'No financial statements have been uploaded yet.' : 'No profit and loss or balance sheet could be read from the uploaded files.'}
        </p>
      ) : (
        <>
          {comparison.annualYears < 2 && <p className="text-xs text-foreground/60">Only one financial year is on file so far: upload the earlier years to compare.</p>}
          {(earlierYears || comparison.hiddenComparativeYears.length > 0) && (
            <label className="no-print flex items-center gap-2 text-xs text-foreground/70">
              <input type="checkbox" checked={earlierYears} onChange={(e) => router.push(e.target.checked ? `?earlier=1` : '?')} className="accent-accent" />
              Show earlier years from comparative columns
              {!earlierYears && (
                <span className="text-foreground/45">({comparison.hiddenComparativeYears.map((y) => `FY${y}`).join(', ')}: printed only as the previous year in a later report)</span>
              )}
            </label>
          )}
          <HeadlineFiguresTable clientId={clientId} basePath={basePath} comparison={comparison} rows={rows} mapping={mapping} suggestions={suggestions} possible={possible} />
        </>
      )}
    </div>
  )
}
