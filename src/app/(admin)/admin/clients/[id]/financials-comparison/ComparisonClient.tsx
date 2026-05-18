'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, RefreshCw, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { ScorecardTiles } from '@/components/admin/financials/ScorecardTiles'
import { AiNarrativeCallout } from '@/components/admin/financials/AiNarrativeCallout'
import { IncomeStatementCompareTable } from '@/components/admin/financials/IncomeStatementCompareTable'
import { BalanceSheetCompareTable } from '@/components/admin/financials/BalanceSheetCompareTable'
import { RatiosPanel } from '@/components/admin/financials/RatiosPanel'
import { ExportButton } from '@/components/admin/financials/ExportButton'
import type { FinancialsComparison } from '@/lib/financials/types'

interface ExtractionState {
  extractedCount: number
  documentCount: number
  hasUnextracted: boolean
}

interface Props {
  clientId: string
  clientName: string
  initialComparison: FinancialsComparison | null
  initialAiSummary: string | null
  initialGeneratedAt: string | null
  initialExtraction: ExtractionState
}

interface ExtractError {
  documentId: string
  filename: string
  error: string
}

export function ComparisonClient({
  clientId,
  clientName,
  initialComparison,
  initialAiSummary,
  initialGeneratedAt,
  initialExtraction,
}: Props) {
  const router = useRouter()
  const [comparison, setComparison] = useState<FinancialsComparison | null>(initialComparison)
  const [aiSummary, setAiSummary] = useState<string | null>(initialAiSummary)
  const [generatedAt, setGeneratedAt] = useState<string | null>(initialGeneratedAt)
  const [extraction, setExtraction] = useState<ExtractionState>(initialExtraction)
  const [errors, setErrors] = useState<ExtractError[]>([])

  const [extracting, setExtracting] = useState(false)
  const [comparing, setComparing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function runExtraction() {
    setExtracting(true)
    setError(null)
    setErrors([])
    try {
      const res = await fetch(`/api/admin/clients/${clientId}/extract-financials`, {
        method: 'POST',
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Extraction failed.')
        return false
      }
      if (Array.isArray(data.errors) && data.errors.length > 0) {
        setErrors(data.errors as ExtractError[])
      }
      router.refresh() // pulls in fresh extraction state
      return true
    } catch {
      setError('Network error during extraction.')
      return false
    } finally {
      setExtracting(false)
    }
  }

  async function runComparison() {
    setComparing(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/clients/${clientId}/financials-comparison`, {
        method: 'POST',
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Comparison failed.')
        return false
      }
      setComparison(data.comparison as FinancialsComparison)
      setAiSummary(data.aiSummary ?? null)
      setGeneratedAt(data.generatedAt ?? null)
      setExtraction((prev) => ({ ...prev, extractedCount: data.statementCount }))
      return true
    } catch {
      setError('Network error during comparison.')
      return false
    } finally {
      setComparing(false)
    }
  }

  async function runBoth() {
    const ok = await runExtraction()
    if (!ok) return
    // Wait for the router-refresh cycle implicitly; trigger comparison.
    await runComparison()
  }

  const hasComparison = comparison !== null
  const periodRangeLabel = comparison
    ? `${formatIso(comparison.periodRange.start)} to ${formatIso(comparison.periodRange.end)}`
    : null

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="space-y-3">
        <Link
          href={`/admin/clients/${clientId}`}
          className="inline-flex items-center gap-1 text-xs text-foreground/50 hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to client
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-foreground">
              Financial Statements — Compare Across Years
            </h1>
            <p className="text-sm text-foreground/60 mt-0.5">{clientName}</p>
            {comparison && (
              <p className="text-xs text-foreground/40 mt-1">
                {comparison.years.length} years extracted
                {periodRangeLabel && ` · ${periodRangeLabel}`}
                {generatedAt && ` · Generated ${formatIso(generatedAt)}`}
              </p>
            )}
          </div>

          {hasComparison && (
            <div className="flex flex-wrap items-center gap-2">
              <ExportButton
                comparison={comparison}
                aiSummary={aiSummary}
                clientName={clientName}
              />
              <Button variant="ghost" size="sm" onClick={runBoth} loading={extracting || comparing}>
                <RefreshCw className="h-3.5 w-3.5" />
                Re-extract & re-run
              </Button>
              <Button variant="primary" size="sm" onClick={runComparison} loading={comparing}>
                Re-run comparison
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Errors */}
      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {errors.length > 0 && <ExtractionErrors errors={errors} />}

      {/* Empty / partial state — no comparison yet */}
      {!hasComparison && (
        <EmptyState
          extraction={extraction}
          onRun={runBoth}
          running={extracting || comparing}
        />
      )}

      {/* Full comparison content */}
      {hasComparison && (
        <>
          {/* Partial extraction warning */}
          {extraction.hasUnextracted && (
            <div className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/10 p-3">
              <AlertTriangle className="h-4 w-4 shrink-0 text-warning mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium text-foreground">
                  {extraction.extractedCount} of {extraction.documentCount} PDF
                  {extraction.documentCount === 1 ? '' : 's'} extracted
                </p>
                <p className="text-xs text-foreground/60 mt-0.5">
                  The remaining files have not been parsed yet. Re-run extraction to include them.
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={runBoth} loading={extracting || comparing}>
                Extract remaining
              </Button>
            </div>
          )}

          <ScorecardTiles comparison={comparison} />

          {aiSummary && <AiNarrativeCallout text={aiSummary} />}

          <IncomeStatementCompareTable comparison={comparison} />
          <BalanceSheetCompareTable comparison={comparison} />
          <RatiosPanel comparison={comparison} />
        </>
      )}
    </div>
  )
}

function EmptyState({
  extraction,
  onRun,
  running,
}: {
  extraction: ExtractionState
  onRun: () => void
  running: boolean
}) {
  if (extraction.documentCount === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface p-8 text-center">
        <p className="text-sm text-foreground/60">
          No historical-financials PDFs have been uploaded yet.
        </p>
        <p className="text-xs text-foreground/40 mt-1">
          The client needs to upload at least 2 annual financial statements to enable the comparison.
        </p>
      </div>
    )
  }

  if (extraction.documentCount < 2) {
    return (
      <div className="rounded-xl border border-border bg-surface p-8 text-center">
        <p className="text-sm text-foreground/60">
          Only 1 PDF uploaded. Need at least 2 years to compare.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-accent/30 bg-accent/5 p-8 text-center">
      <p className="text-sm font-medium text-foreground">
        {extraction.documentCount} financial statement{extraction.documentCount === 1 ? '' : 's'} uploaded
      </p>
      <p className="text-xs text-foreground/55 mt-1.5 mb-4">
        Click below to extract the figures and run the comparison — this takes about a minute.
      </p>
      <Button variant="primary" size="md" onClick={onRun} loading={running}>
        Extract &amp; Compare
      </Button>
    </div>
  )
}

function ExtractionErrors({ errors }: { errors: ExtractError[] }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-xs font-medium text-destructive"
      >
        <span>
          {errors.length} document{errors.length === 1 ? '' : 's'} could not be extracted
        </span>
        {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>
      {open && (
        <ul className="mt-2 space-y-1">
          {errors.map((e) => (
            <li key={e.documentId} className="text-xs text-foreground/60">
              <span className="text-foreground/80">{e.filename}:</span> {e.error}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function formatIso(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-AU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}
