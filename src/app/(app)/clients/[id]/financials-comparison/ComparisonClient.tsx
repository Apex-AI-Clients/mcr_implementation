'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft,
  RefreshCw,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Loader2,
  CheckCircle2,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { ScorecardTiles } from '@/components/admin/financials/ScorecardTiles'
import { AiNarrativeCallout } from '@/components/admin/financials/AiNarrativeCallout'
import { IncomeStatementCompareTable } from '@/components/admin/financials/IncomeStatementCompareTable'
import { BalanceSheetCompareTable } from '@/components/admin/financials/BalanceSheetCompareTable'
import { RatiosPanel } from '@/components/admin/financials/RatiosPanel'
import { ExportButton } from '@/components/admin/financials/ExportButton'
import { ExportPdfButton } from '@/components/admin/ExportPdfButton'
import { StatementCoverageTable } from '@/components/admin/financials/StatementCoverageTable'
import { ComparisonChecksPanel } from '@/components/admin/financials/ComparisonChecksPanel'
import type { StatementCoverage } from '@/lib/financials/coverage'
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
  /** An in-flight job to resume polling (set when the page loads mid-run). */
  initialJobId: string | null
  /** Which statement each year has, from the stored statements as they are now. */
  coverage: StatementCoverage
  /** Set when a financials document was deleted after the comparison was built. */
  initialStaleSince: string | null
  /**
   * Show "Statements on file" and the statement checks. Development and test
   * deployments only (SHOW_FINANCIALS_DIAGNOSTICS); hidden in production.
   */
  showDiagnostics: boolean
}

interface ExtractError {
  documentId: string
  filename: string
  error: string
}

type JobMode = 'full' | 'compare'
type JobPhase = 'idle' | 'pending' | 'processing' | 'done' | 'failed'

interface ComparisonPayload {
  comparison: FinancialsComparison
  aiSummary: string | null
  generatedAt: string
  statementCount: number
}

interface JobStatusResponse {
  status: Exclude<JobPhase, 'idle'>
  mode: JobMode
  error: string | null
  result: ComparisonPayload | null
  extractErrors: ExtractError[]
}

const POLL_INTERVAL_MS = 4000

export function ComparisonClient({
  clientId,
  clientName,
  initialComparison,
  initialAiSummary,
  initialGeneratedAt,
  initialExtraction,
  initialJobId,
  coverage,
  initialStaleSince,
  showDiagnostics,
}: Props) {
  const router = useRouter()
  const [comparison, setComparison] = useState<FinancialsComparison | null>(initialComparison)
  const [aiSummary, setAiSummary] = useState<string | null>(initialAiSummary)
  const [generatedAt, setGeneratedAt] = useState<string | null>(initialGeneratedAt)
  const [extraction, setExtraction] = useState<ExtractionState>(initialExtraction)
  const [errors, setErrors] = useState<ExtractError[]>([])
  const [error, setError] = useState<string | null>(null)
  const [staleSince, setStaleSince] = useState<string | null>(initialStaleSince)
  // The statement checks are for staff, not the exported report, unless asked for.
  const [includeChecks, setIncludeChecks] = useState(false)

  const [phase, setPhase] = useState<JobPhase>(initialJobId ? 'processing' : 'idle')

  // Track the active poll loop so we can cancel it on unmount / new job.
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activeJobId = useRef<string | null>(initialJobId)
  const modeRef = useRef<JobMode>('full')

  const clearPoll = useCallback(() => {
    if (pollTimer.current) {
      clearTimeout(pollTimer.current)
      pollTimer.current = null
    }
  }, [])

  const applyDone = useCallback(
    (data: JobStatusResponse) => {
      if (data.result) {
        setComparison(data.result.comparison)
        setAiSummary(data.result.aiSummary)
        setGeneratedAt(data.result.generatedAt)
        setExtraction((prev) => ({
          ...prev,
          // Documents, not statements: a full run has been through every one.
          extractedCount: data.mode === 'full' ? prev.documentCount : prev.extractedCount,
          // A full run extracts every uploaded PDF.
          hasUnextracted: data.mode === 'full' ? false : prev.hasUnextracted,
        }))
      }
      setErrors(data.extractErrors ?? [])
      setPhase('done')
      // Rebuilt from the documents as they are now.
      setStaleSince(null)
      router.refresh() // refresh server-rendered extraction counts and coverage
    },
    [router],
  )

  // Poll the status endpoint until the job resolves. Uses recursive setTimeout
  // (not setInterval) so a slow response never overlaps the next poll.
  const poll = useCallback(
    async (jobId: string) => {
      try {
        const res = await fetch(
          `/api/admin/clients/${clientId}/financials-comparison/status/${jobId}`,
          { cache: 'no-store' },
        )
        if (activeJobId.current !== jobId) return // a newer job superseded this one
        if (res.status === 401) {
          // Signed out mid-run. The run itself carries on on the server; signing
          // back in reopens this page, which picks it up again.
          setError('Your session ended. Sign in again — the comparison keeps running and this page will pick it up.')
          setPhase('failed')
          return
        }
        const data = (await res.json()) as JobStatusResponse & { error?: string }
        if (!res.ok) {
          setError(data.error ?? 'Failed to read job status.')
          setPhase('failed')
          return
        }

        if (data.status === 'done') {
          applyDone(data)
          return
        }
        if (data.status === 'failed') {
          setError(data.error ?? 'The comparison failed. Please try again.')
          setErrors(data.extractErrors ?? [])
          setPhase('failed')
          return
        }

        // pending | processing — keep polling.
        setPhase(data.status)
        pollTimer.current = setTimeout(() => poll(jobId), POLL_INTERVAL_MS)
      } catch {
        if (activeJobId.current !== jobId) return
        setError('Network error while checking job status.')
        setPhase('failed')
      }
    },
    [clientId, applyDone],
  )

  const startJob = useCallback(
    async (mode: JobMode) => {
      clearPoll()
      setError(null)
      setErrors([])
      setPhase('pending')
      modeRef.current = mode
      try {
        const res = await fetch(
          `/api/admin/clients/${clientId}/financials-comparison/start`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode }),
          },
        )
        const data = (await res.json()) as { jobId?: string; error?: string }
        if (!res.ok || !data.jobId) {
          setError(data.error ?? 'Failed to start the comparison.')
          setPhase('failed')
          return
        }
        activeJobId.current = data.jobId
        void poll(data.jobId)
      } catch {
        // The answer was lost, not necessarily the run: the server may have
        // created the job before the connection dropped (a preview deployment
        // cold-starting or being replaced). Refreshing hands any job it did
        // start back to this page, which then picks it up (effect below).
        setError('Could not confirm the comparison started. Checking for a run in progress…')
        setPhase('failed')
        router.refresh()
      }
    },
    [clientId, clearPoll, poll, router],
  )

  // On load: resume an in-flight job, otherwise auto-start the comparison when
  // there's no saved result yet and enough statements are uploaded — saves the
  // user a redundant "Extract & Compare" click. Tidy up the timer on unmount.
  useEffect(() => {
    if (initialJobId) {
      activeJobId.current = initialJobId
      void poll(initialJobId)
    } else if (!initialComparison && initialExtraction.documentCount >= 2) {
      void startJob('full')
    }
    return clearPoll
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A job found by a later refresh (e.g. after a start request whose answer
  // was lost) is picked up and followed like any other.
  useEffect(() => {
    if (initialJobId && initialJobId !== activeJobId.current) {
      activeJobId.current = initialJobId
      setError(null)
      setPhase('processing')
      void poll(initialJobId)
    }
  }, [initialJobId, poll])

  const runFull = useCallback(() => startJob('full'), [startJob])
  const runCompareOnly = useCallback(() => startJob('compare'), [startJob])

  const running = phase === 'pending' || phase === 'processing'
  const hasComparison = comparison !== null
  const periodRangeLabel = comparison
    ? `${formatIso(comparison.periodRange.start)} to ${formatIso(comparison.periodRange.end)}`
    : null

  return (
    <div id="financials-export-root" className="space-y-6">
      {/* Page header */}
      <div className="space-y-3">
        <Link
          href={`/clients/${clientId}`}
          className="no-print inline-flex items-center gap-1 text-xs text-foreground/50 hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to client
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold text-foreground">
                Financial Statements — Compare Across Years
              </h1>
              {/* Status badge — screen-only (no-print keeps it out of the PDF;
                  the CSV is built from data, so it never appears there). */}
              {phase === 'pending' || phase === 'processing' ? (
                <Badge variant="accent" className="no-print">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Processing
                </Badge>
              ) : phase === 'done' ? (
                <Badge variant="success" className="no-print">
                  <CheckCircle2 className="h-3 w-3" />
                  Completed
                </Badge>
              ) : phase === 'failed' ? (
                <Badge variant="destructive" className="no-print">
                  <AlertTriangle className="h-3 w-3" />
                  Failed
                </Badge>
              ) : null}
            </div>
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
            <div className="no-print flex flex-wrap items-center gap-2">
              {showDiagnostics && comparison.checks && comparison.checks.length > 0 && (
                <label className="flex items-center gap-1.5 text-xs text-foreground/60">
                  <input
                    type="checkbox"
                    checked={includeChecks}
                    onChange={(event) => setIncludeChecks(event.target.checked)}
                    className="accent-accent"
                  />
                  Include checks in PDF
                </label>
              )}
              <ExportPdfButton
                targetId="financials-export-root"
                fileName={`${clientName}_financials_comparison`}
              />
              <ExportButton
                comparison={comparison}
                aiSummary={aiSummary}
                clientName={clientName}
              />
              <Button variant="ghost" size="sm" onClick={runFull} loading={running} disabled={running}>
                <RefreshCw className="h-3.5 w-3.5" />
                Re-extract & re-run
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={runCompareOnly}
                loading={running}
                disabled={running}
              >
                Re-run comparison
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* In-progress status — shown only when a comparison already exists (a
          re-run). The first run with no comparison yet shows its loading state
          inside EmptyState instead, to avoid two stacked loading panels. */}
      {running && hasComparison && (
        <div className="no-print flex items-center gap-3 rounded-lg border border-accent/30 bg-accent/5 px-4 py-3">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent" />
          <div>
            <p className="text-sm font-medium text-foreground">
              {modeRef.current === 'compare'
                ? 'Rebuilding the comparison…'
                : 'Extracting financials and building the comparison…'}
            </p>
            <p className="text-xs text-foreground/55 mt-0.5">
              This runs in the background and can take a few minutes. You can leave this page
              open — it updates automatically when finished.
            </p>
          </div>
        </div>
      )}

      {/* Errors — screen only: a run's transient state never belongs in an export. */}
      {error && (
        <div className="no-print rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {errors.length > 0 && (
        <div className="no-print">
          <ExtractionErrors errors={errors} />
        </div>
      )}

      {/* A document behind these figures has gone since they were built. */}
      {hasComparison && staleSince && !running && (
        <div className="no-print flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/10 p-3">
          <AlertTriangle className="h-4 w-4 shrink-0 text-warning mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-medium text-foreground">This comparison is out of date</p>
            <p className="text-xs text-foreground/60 mt-0.5">
              A financial statement file was deleted on {formatIso(staleSince)}, after these figures
              were built. Re-run the comparison so they match the files that are left.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={runCompareOnly} disabled={running}>
            Re-run comparison
          </Button>
        </div>
      )}

      {/* Which statement each year has. Built fresh from storage on every load. */}
      {showDiagnostics && coverage.columns.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-foreground mb-3">Statements on file</h3>
          <StatementCoverageTable coverage={coverage} />
        </div>
      )}

      {/* Empty / partial state — no comparison yet */}
      {!hasComparison && (
        <EmptyState
          extraction={extraction}
          onRun={runFull}
          running={running}
          failed={phase === 'failed'}
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
              <Button
                variant="ghost"
                size="sm"
                onClick={runFull}
                loading={running}
                disabled={running}
                className="no-print"
              >
                Extract remaining
              </Button>
            </div>
          )}

          {showDiagnostics && comparison.checks && comparison.checks.length > 0 && (
            <div className={includeChecks ? undefined : 'no-print'}>
              <ComparisonChecksPanel checks={comparison.checks} />
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
  failed,
}: {
  extraction: ExtractionState
  onRun: () => void
  running: boolean
  failed: boolean
}) {
  if (extraction.documentCount === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface p-8 text-center">
        <p className="text-sm text-foreground/60">
          No financial statement PDFs have been uploaded yet.
        </p>
        <p className="text-xs text-foreground/40 mt-1">
          At least 2 years of annual statements are needed — one combined PDF per year, or a separate
          Profit and Loss and Balance Sheet.
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

  // With ≥2 statements the comparison auto-starts on load, so there's no manual
  // "Extract & Compare" prompt — show a loading state instead. If the run failed,
  // offer a retry (the error message itself is rendered above this).
  if (failed) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-8 text-center">
        <p className="text-sm font-medium text-foreground">The comparison didn’t complete.</p>
        <p className="text-xs text-foreground/55 mt-1.5 mb-4">You can run it again below.</p>
        <Button variant="primary" size="md" onClick={onRun} loading={running}>
          <RefreshCw className="h-4 w-4" />
          Retry
        </Button>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-accent/30 bg-accent/5 p-8 text-center">
      <Loader2 className="mx-auto h-6 w-6 animate-spin text-accent" />
      <p className="mt-3 text-sm font-medium text-foreground">
        Extracting figures and building the comparison…
      </p>
      <p className="mt-1.5 text-xs text-foreground/55">
        This runs in the background and can take a few minutes. It updates automatically when finished.
      </p>
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
