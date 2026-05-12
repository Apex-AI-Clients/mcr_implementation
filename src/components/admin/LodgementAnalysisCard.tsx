'use client'

import { useState } from 'react'
import { Activity, ChevronDown, ChevronUp, Download, Info, X } from 'lucide-react'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { formatDateRelative, formatDate } from '@/lib/utils'
import { cn } from '@/lib/utils'
import type { LodgementAnalysisPayload, EnrichedRow, AnalysisWarning } from '@/lib/analysis/types'

interface Props {
  clientId: string
  initialAnalysis: LodgementAnalysisPayload | null
  hasActivityStatementCsv: boolean
}

// ─── CSV export helpers ───────────────────────────────────────────────────────

function csvCell(value: string | number | null | undefined): string {
  const s = value === null || value === undefined ? '' : String(value)
  // Quote if contains comma, double-quote, or newline
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

function csvRow(...cells: (string | number | null | undefined)[]): string {
  return cells.map(csvCell).join(',')
}

function formatCurrencyExport(value: number | null): string {
  if (value === null) return ''
  return `$${Math.abs(value).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`
}

function formatBalanceExport(value: number | null): string {
  if (value === null) return ''
  return value >= 0
    ? `${formatCurrencyExport(value)} DR`
    : `${formatCurrencyExport(value)} CR`
}

function formatDateExport(d: Date | string | null | undefined): string {
  if (!d) return ''
  const date = typeof d === 'string' ? new Date(d) : d
  return date.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: '2-digit' }).replace(/ /g, '-')
}

function buildExportCsv(analysis: LodgementAnalysisPayload): string {
  const lines: string[] = []

  const label = analysis.statementLabel ?? ''
  const company = analysis.companyNameInCsv ?? ''
  const numLate = analysis.summary.numberOfLateLodgements
  const cumDays = analysis.summary.cumulativeDaysLate

  // Preamble rows — summary stats placed in cols G & H (cols 7 & 8)
  lines.push(csvRow(label, '', '', '', '', '', 'Number Late Lodgements', numLate))
  lines.push(csvRow('', '', '', '', '', '', 'Cumulative Days Late', cumDays))
  lines.push(csvRow(company))
  lines.push('')

  // Column headers
  lines.push(csvRow(
    'Processed date',
    'Effective date',
    'Description',
    'Debit (DR)',
    'Credit (CR)',
    'Balance',
    'Late Lodgements (Days)',
    'Late Lodge Days cleaned',
  ))

  // All data rows
  for (const row of analysis.rows) {
    const processedDate = row.processedDate ? new Date(row.processedDate as unknown as string) : null
    const effectiveDate = row.effectiveDate ? new Date(row.effectiveDate as unknown as string) : null

    // Prefix description with apostrophe for Excel safety (matches original ATO format)
    const description = row.description ? `'${row.description}` : ''

    lines.push(csvRow(
      formatDateExport(processedDate),
      formatDateExport(effectiveDate),
      description,
      formatCurrencyExport(row.debit),
      formatCurrencyExport(row.credit),
      formatBalanceExport(row.balance),
      row.lateLodgementDays,
      row.lateLodgeDaysCleaned,
    ))
  }

  return lines.join('\r\n')
}

function downloadCsv(content: string, filename: string) {
  const blob = new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatTile({
  value,
  label,
  severity,
}: {
  value: number
  label: string
  severity: 'ok' | 'warning' | 'danger'
}) {
  return (
    <div
      className={cn('flex flex-col items-center justify-center rounded-lg p-4 text-center', {
        'bg-success/10 border border-success/20': severity === 'ok',
        'bg-warning/10 border border-warning/20': severity === 'warning',
        'bg-destructive/10 border border-destructive/20': severity === 'danger',
      })}
    >
      <span
        className={cn('text-3xl font-bold tabular-nums', {
          'text-success': severity === 'ok',
          'text-warning': severity === 'warning',
          'text-destructive': severity === 'danger',
        })}
      >
        {value}
      </span>
      <span className="mt-1 text-xs text-foreground/50">{label}</span>
    </div>
  )
}

function getSeverity(numberOfLate: number): 'ok' | 'warning' | 'danger' {
  if (numberOfLate === 0) return 'ok'
  if (numberOfLate > 20) return 'danger'
  return 'warning'
}

function ContributingTable({ rows }: { rows: EnrichedRow[] }) {
  const late = rows.filter((r) => r.lateLodgeDaysCleaned > 0)
  if (late.length === 0) return <p className="text-xs text-foreground/40 italic">No late lodgements.</p>

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border text-left text-foreground/40">
            <th className="pb-2 pr-4 font-medium">Processed</th>
            <th className="pb-2 pr-4 font-medium">Effective</th>
            <th className="pb-2 pr-4 font-medium">Description</th>
            <th className="pb-2 font-medium text-right">Days Late</th>
          </tr>
        </thead>
        <tbody>
          {late.map((row) => (
            <tr key={row.rowIndex} className="border-b border-border/40 last:border-0">
              <td className="py-1.5 pr-4 text-foreground/70 whitespace-nowrap">
                {row.processedDate ? formatDate(new Date(row.processedDate as unknown as string).toISOString()) : '—'}
              </td>
              <td className="py-1.5 pr-4 text-foreground/70 whitespace-nowrap">
                {row.effectiveDate ? formatDate(new Date(row.effectiveDate as unknown as string).toISOString()) : '—'}
              </td>
              <td className="py-1.5 pr-4 text-foreground/70 max-w-xs truncate" title={row.description}>
                {row.description}
              </td>
              <td className="py-1.5 text-right font-semibold text-warning">
                {row.lateLodgeDaysCleaned}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function WarningsList({ warnings }: { warnings: AnalysisWarning[] }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-3 rounded-lg bg-destructive/10 border border-destructive/20 p-3">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-xs text-destructive font-medium"
      >
        <span>{warnings.length} row(s) skipped due to unparseable dates</span>
        {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>
      {open && (
        <ul className="mt-2 space-y-1">
          {warnings.map((w) => (
            <li key={w.rowIndex} className="text-xs text-foreground/60">
              Row {w.rowIndex}: {w.description} (processed: &quot;{w.rawProcessed}&quot;, effective: &quot;{w.rawEffective}&quot;)
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ─── Summary panel ────────────────────────────────────────────────────────────

function SummaryPanel({
  analysis,
  onClose,
}: {
  analysis: LodgementAnalysisPayload
  onClose: () => void
}) {
  const { numberOfLateLodgements, cumulativeDaysLate } = analysis.summary
  const totalLodgements = analysis.rows.filter(
    (r) => r.lodgementType === 'Original' || r.lodgementType === 'ClientAmended',
  ).length

  return (
    <div className="rounded-lg border border-border bg-surface p-4 text-xs space-y-4">
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-sm font-semibold text-foreground">How this analysis works</h4>
        <button onClick={onClose} className="text-foreground/40 hover:text-foreground transition-colors shrink-0">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="space-y-1">
        <p className="text-foreground/50 leading-relaxed">
          The ATO Activity Statement ledger contains two key dates per lodgement row:
        </p>
        <ul className="list-disc list-inside space-y-0.5 text-foreground/50 leading-relaxed pl-1">
          <li><span className="text-foreground/70 font-medium">Processed date</span> — when the ATO actually received and processed the lodgement.</li>
          <li><span className="text-foreground/70 font-medium">Effective date</span> — the statutory due date the lodgement was supposed to be filed by.</li>
        </ul>
      </div>

      <div className="space-y-1">
        <p className="text-foreground/60 font-medium">What counts as a late lodgement?</p>
        <p className="text-foreground/50 leading-relaxed">
          Only <span className="text-foreground/70">Original</span> and <span className="text-foreground/70">Client-initiated Amended</span> activity statements are assessed — ATO-initiated amendments and sub-lines (GST, PAYG, etc.) are excluded. A lodgement is late when the Processed date falls after the Effective date, i.e. the difference is positive.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-border bg-primary/30 p-3 space-y-1">
          <p className="font-semibold text-foreground">
            Number of Late Lodgements
            <span className="ml-2 text-warning">{numberOfLateLodgements}</span>
          </p>
          <p className="text-foreground/50 leading-relaxed">
            Out of <span className="text-foreground/70">{totalLodgements}</span> total lodgement rows assessed, <span className="text-foreground/70">{numberOfLateLodgements}</span> had a positive days-late value (i.e. the ATO processed them after the due date).
          </p>
        </div>

        <div className="rounded-lg border border-border bg-primary/30 p-3 space-y-1">
          <p className="font-semibold text-foreground">
            Cumulative Days Late
            <span className="ml-2 text-warning">{cumulativeDaysLate}</span>
          </p>
          <p className="text-foreground/50 leading-relaxed">
            The sum of calendar days late across all {numberOfLateLodgements} late lodgements. Early lodgements do not offset this total — negative values are zeroed before summing. This figure feeds the downstream SBR risk model.
          </p>
        </div>
      </div>

      <p className="text-foreground/30 leading-relaxed border-t border-border pt-3">
        Lateness is measured in <span className="text-foreground/50">calendar days</span>, not business days. The ATO sets the Effective date accounting for weekends and public holidays, so no further adjustment is needed.
      </p>
    </div>
  )
}

// ─── Main card ────────────────────────────────────────────────────────────────

export function LodgementAnalysisCard({ clientId, initialAnalysis, hasActivityStatementCsv }: Props) {
  const [analysis, setAnalysis] = useState<LodgementAnalysisPayload | null>(initialAnalysis)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showTable, setShowTable] = useState(false)
  const [showSummary, setShowSummary] = useState(false)

  async function runAnalysis() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/clients/${clientId}/analyse-lodgements`, {
        method: 'POST',
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Analysis failed.')
        return
      }
      setAnalysis(data as LodgementAnalysisPayload)
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  function handleExport() {
    if (!analysis) return
    const csv = buildExportCsv(analysis)
    const name = analysis.sourceFilename.replace(/\.csv$/i, '')
    downloadCsv(csv, `${name} — Late Lodgements.csv`)
  }

  const severity = analysis ? getSeverity(analysis.summary.numberOfLateLodgements) : 'ok'
  const lateRows = analysis ? analysis.rows.filter((r) => r.lateLodgeDaysCleaned > 0) : []

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-foreground/50" />
          <CardTitle>Lodgement Compliance Analysis With AI</CardTitle>
        </div>
        {analysis && (
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={handleExport}>
              <Download className="h-3.5 w-3.5" />
              Export
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setShowSummary((v) => !v)}>
              <Info className="h-3.5 w-3.5" />
              Summary
            </Button>
            <Button variant="ghost" size="sm" onClick={runAnalysis} loading={loading}>
              Re-analyse
            </Button>
          </div>
        )}
      </CardHeader>

      {!hasActivityStatementCsv && (
        <div className="space-y-3">
          <p className="text-xs text-foreground/40">
            Upload an Activity Statement Account CSV under the Integrated Client Account category to
            run this analysis.
          </p>
          <Button variant="primary" size="sm" disabled>
            <Activity className="h-3.5 w-3.5" />
            Analyse Lodgements with AI
          </Button>
        </div>
      )}

      {hasActivityStatementCsv && !analysis && (
        <div className="space-y-3">
          <p className="text-xs text-foreground/50">
            Activity Statement CSV detected. Run the analysis to compute late lodgements.
          </p>
          <Button variant="primary" size="sm" onClick={runAnalysis} loading={loading}>
            <Activity className="h-3.5 w-3.5" />
            Analyse Lodgements with AI
          </Button>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      )}

      {analysis && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <StatTile
              value={analysis.summary.numberOfLateLodgements}
              label="Number of Late Lodgements"
              severity={severity}
            />
            <StatTile
              value={analysis.summary.cumulativeDaysLate}
              label="Cumulative Days Late"
              severity={severity}
            />
          </div>

          {showSummary && (
            <SummaryPanel analysis={analysis} onClose={() => setShowSummary(false)} />
          )}

          <p className="text-xs text-foreground/30">
            Analysed {formatDateRelative(analysis.analysedAt)} · Source: {analysis.sourceFilename}
          </p>

          {/* {lateRows.length > 0 && (
            <div>
              <button
                onClick={() => setShowTable((v) => !v)}
                className="flex items-center gap-1 text-xs text-foreground/50 hover:text-foreground transition-colors"
              >
                {showTable ? (
                  <ChevronUp className="h-3.5 w-3.5" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" />
                )}
                {showTable ? 'Hide' : 'Show'} contributing lodgements ({lateRows.length})
              </button>
              {showTable && (
                <div className="mt-3">
                  <ContributingTable rows={analysis.rows} />
                </div>
              )}
            </div>
          )} */}

          {analysis.warnings.length > 0 && <WarningsList warnings={analysis.warnings} />}

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      )}
    </Card>
  )
}
