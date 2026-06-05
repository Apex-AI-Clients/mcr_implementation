'use client'

import { useState, useEffect } from 'react'
import { Activity, ChevronDown, ChevronUp, Download, Info, X } from 'lucide-react'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { ExportPdfButton } from '@/components/admin/ExportPdfButton'
import { formatDateRelative, formatDate } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { DpnRiskPanel } from '@/components/admin/lodgement/DpnRiskPanel'
import { DebtCompositionPanel } from '@/components/admin/lodgement/DebtCompositionPanel'
import type { LodgementAnalysisPayload, EnrichedRow, AnalysisWarning } from '@/lib/analysis/types'

interface Props {
  clientId: string
  initialAnalysis: LodgementAnalysisPayload | null
  hasActivityStatementCsv: boolean
}

// ─── CSV export helpers ───────────────────────────────────────────────────────

function csvCell(value: string | number | null | undefined): string {
  const s = value === null || value === undefined ? '' : String(value)
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

function csvRow(...cells: (string | number | null | undefined)[]): string {
  return cells.map(csvCell).join(',')
}

function formatCurrencyExport(value: number | null | undefined): string {
  if (value === null || value === undefined) return ''
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

function formatIsoExport(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-AU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

function buildExportCsv(analysis: LodgementAnalysisPayload): string {
  const lines: string[] = []

  const label = analysis.statementLabel ?? ''
  const company = analysis.companyNameInCsv ?? ''
  const numLate = analysis.summary.numberOfLateLodgements
  const cumDays = analysis.summary.cumulativeDaysLate

  // Preamble rows — summary stats
  lines.push(csvRow(label, '', '', '', '', '', 'Number Late Lodgements', numLate))
  lines.push(csvRow('', '', '', '', '', '', 'Cumulative Days Late', cumDays))
  lines.push(csvRow(company))
  lines.push('')

  // DPN Risk Summary block
  if (analysis.dpnRisk) {
    const dpn = analysis.dpnRisk
    lines.push(csvRow('DPN Risk Summary'))
    lines.push(csvRow('Gross debt lodged >90 days late', formatCurrencyExport(dpn.totalGrossLate)))
    lines.push(csvRow('Paid since lodged', formatCurrencyExport(dpn.totalPaidSince)))
    lines.push(csvRow('Net amount at risk', formatCurrencyExport(dpn.totalNetAtRisk)))
    lines.push(
      csvRow(
        'Period covered',
        dpn.periodStart && dpn.periodEnd
          ? `${formatIsoExport(dpn.periodStart)} to ${formatIsoExport(dpn.periodEnd)}`
          : '—',
      ),
    )
    lines.push('')
  }

  // Debt Composition block
  if (analysis.debtBreakdown) {
    const db = analysis.debtBreakdown
    lines.push(csvRow('Debt Composition'))
    lines.push(csvRow('Principal (gross debits)', formatCurrencyExport(db.principalDebits)))
    lines.push(csvRow('Less: amendment credits', formatCurrencyExport(db.principalCredits)))
    lines.push(csvRow('Principal (net)', formatCurrencyExport(db.principalNet)))
    lines.push(csvRow('Interest / GIC (gross)', formatCurrencyExport(db.interestDebits)))
    lines.push(csvRow('Less: GIC remissions', formatCurrencyExport(db.interestCredits)))
    lines.push(csvRow('Interest (net)', formatCurrencyExport(db.interestNet)))
    lines.push(csvRow('Penalties (net)', formatCurrencyExport(db.penaltyNet)))
    lines.push(csvRow('Total ATO debt accrued', formatCurrencyExport(db.totalAtoDebt)))
    lines.push(csvRow('Payments received', formatCurrencyExport(db.paymentsReceived)))
    lines.push(csvRow('Government credits (Cash Flow Boost etc)', formatCurrencyExport(db.governmentCredits)))
    lines.push(csvRow('Other credits', formatCurrencyExport(db.otherCredits)))
    lines.push(csvRow('Current balance owing', formatCurrencyExport(db.currentBalance)))
    lines.push('')
  }

  // AI Summary block
  if (analysis.aiSummary) {
    lines.push(csvRow('AI Summary'))
    lines.push(csvCell(analysis.aiSummary))
    lines.push('')
  }

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
}: {
  analysis: LodgementAnalysisPayload
  onClose?: () => void
}) {
  const { numberOfLateLodgements, cumulativeDaysLate } = analysis.summary

  return (
    <div className="p-5 space-y-3">
      <h4 className="text-sm font-semibold text-foreground pr-8">How the numbers are calculated</h4>

      {/* Formulas */}
      <div className="rounded-md border border-border bg-primary/40 px-4 py-2.5 font-mono text-sm text-foreground/85">
        <span className="text-accent">Number of Late Lodgements</span> = Count of rows where{' '}
        <span className="text-warning">Processed Date &gt; Effective Date</span>
      </div>
      <div className="rounded-md border border-border bg-primary/40 px-4 py-2.5 font-mono text-sm text-foreground/85">
        <span className="text-accent">Cumulative Days Late</span> ={' '}
        <span className="text-warning">Sum of</span> (Processed Date − Effective Date) per late row
      </div>
      <div className="rounded-md border border-border bg-primary/40 px-4 py-2.5 font-mono text-sm text-foreground/85">
        <span className="text-accent">Gross debt &gt;90 days late</span> ={' '}
        <span className="text-warning">Sum of </span> Debit per Original / Client-Amended row where
        (Processed Date − Statutory Due Date) &gt; 90 days
      </div>
      <div className="rounded-md border border-border bg-primary/40 px-4 py-2.5 font-mono text-sm text-foreground/85">
        <span className="text-accent">Paid since lodged</span> ={' '}
        <span className="text-warning">Sum of </span> credits on Original / Client-Amended rows lodged &gt;90 days late (cash Payments are excluded)
      </div>
      <div className="rounded-md border border-border bg-primary/40 px-4 py-2.5 font-mono text-sm text-foreground/85">
        <span className="text-accent">Net at Risk</span> ={' '}
        <span className="text-warning">max(0, </span> Gross debt &gt;90 days late − Paid since lodged<span className="text-warning">)</span>
      </div>

      {/* Explanation */}
      <p className="text-xs text-foreground/55 leading-relaxed">
        Each lodgement&apos;s delay is calculated as the gap between when the ATO received it and when it was due.
        Early lodgements count as zero — they don&apos;t offset other late rows.
        Both totals below are based on Original and Client-Amended statements only.
      </p>

      {/* Per-metric description tiles */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-md border border-border bg-primary/30 px-4 py-3 space-y-1">
          <p className="text-xs font-semibold text-foreground/80">Number of Late Lodgements</p>
          <p className="text-xs text-foreground/45 leading-relaxed">How many lodgements were received after their due date. To verify: count rows in the CSV where Processed Date is after Effective Date.</p>
        </div>
        <div className="rounded-md border border-border bg-primary/30 px-4 py-3 space-y-1">
          <p className="text-xs font-semibold text-foreground/80">Cumulative Days Late</p>
          <p className="text-xs text-foreground/45 leading-relaxed">All late days added up — the total delay across their entire lodgement history. To verify: for each late row, subtract Effective Date from Processed Date and sum the positive values.</p>
        </div>
        <div className="rounded-md border border-border bg-primary/30 px-4 py-3 space-y-1">
          <p className="text-xs font-semibold text-foreground/80">Gross debt &gt;90 days late</p>
          <p className="text-xs text-foreground/45 leading-relaxed">Total debit raised by Original / Client-Amended lodgements that were filed more than 90 days past their statutory due date. To verify: filter the CSV to those rows and sum the Debit column.</p>
        </div>
        <div className="rounded-md border border-border bg-primary/30 px-4 py-3 space-y-1">
          <p className="text-xs font-semibold text-foreground/80">Paid since lodged</p>
          <p className="text-xs text-foreground/45 leading-relaxed">Sum of credit amounts on Original / Client-Amended rows lodged &gt;90 days late — these are reversals of late-lodged liability (e.g. a client-initiated amendment that reduces a prior period). Cash Payments are NOT counted: the ATO applies them to the oldest debt first, so they may have settled an older non-DPN debit instead of the late lodgement.</p>
        </div>
        <div className="rounded-md border border-border bg-primary/30 px-4 py-3 space-y-1 col-span-2">
          <p className="text-xs font-semibold text-foreground/80">Net at Risk</p>
          <p className="text-xs text-foreground/45 leading-relaxed">Gross debt &gt;90 days late minus the pooled late-credit reversals (floored at zero). This is the conservative ceiling on personal DPN liability — no cash payment has been credited against it because we can&apos;t prove the ATO allocated it to this specific period.</p>
        </div>
      </div>

      {/* DPN Risk explainer */}
      <div className="rounded-md border border-border bg-primary/30 px-4 py-3 space-y-1">
        <p className="text-xs font-semibold text-foreground/80">DPN Risk (&gt;90 days late)</p>
        <p className="text-xs text-foreground/45 leading-relaxed">
          Every Original or Client-Amended lodgement filed more than 90 calendar days past
          its statutory due date is examined. Debits in this bucket add to the gross late
          figure; credits in the same bucket (e.g. late-filed client amendments that reduce
          a prior period&apos;s liability) form a pool that offsets the gross.
        </p>
        <p className="text-xs text-foreground/45 leading-relaxed">
          Cash Payments are deliberately excluded. The ATO applies payments to the oldest
          outstanding debt first, so a $10k payment can be entirely consumed by an older,
          non-DPN debit (prior on-time lodgement, accrued GIC, etc.) without de-risking a
          newer late lodgement at all. Since we can&apos;t prove where any particular payment
          landed, the conservative position is to credit none of them.
        </p>
        <p className="text-xs text-foreground/45 leading-relaxed">
          Why 90 days matters: once a BAS is more than 90 days overdue, the ATO can pursue
          the director personally via a Director Penalty Notice (DPN). The &quot;Net at Risk&quot;
          figure is the maximum personal-liability ceiling after late-credit reversals.
        </p>
      </div>

      {/* Debt Composition explainer */}
      <div className="rounded-md border border-border bg-primary/30 px-4 py-3 space-y-1">
        <p className="text-xs font-semibold text-foreground/80">Debt Composition</p>
        <p className="text-xs text-foreground/45 leading-relaxed">
          Splits the ATO ledger into principal (Original + Client-Amended amounts), interest (General
          Interest Charge and remissions), and penalties. Sub-line rows and ATO-initiated amendments
          are excluded to avoid double-counting. Useful for understanding whether the balance is
          mostly real liability or accumulated charges and interest.
        </p>
      </div>

      {/* What it means */}
      {(() => {
        const { numberOfLateLodgements, cumulativeDaysLate } = analysis.summary
        const dpn = analysis.dpnRisk
        const fmt = (n: number) => n.toLocaleString('en-AU', { maximumFractionDigits: 0 })

        return (
          <div className="rounded-md border border-warning/30 bg-warning/5 px-4 py-3 space-y-1.5">
            <p className="text-sm font-bold text-foreground">What this means for the client</p>
            <p className="text-sm text-foreground/85 leading-snug">
              {numberOfLateLodgements} {numberOfLateLodgements === 1 ? 'lodgement was' : 'lodgements were'} filed late,
              totalling {cumulativeDaysLate} days of delay.
              {dpn && dpn.totalGrossLate > 0 && (
                <>
                  {' '}Of that, ${fmt(dpn.totalGrossLate)} was lodged more than 90 days past due, with
                  ${fmt(dpn.totalPaidSince)} paid since lodgement — leaving{' '}
                  <span className={dpn.totalNetAtRisk > 10000 ? 'text-destructive font-semibold' : 'text-warning font-semibold'}>
                    ${fmt(dpn.totalNetAtRisk)} of personal-liability exposure
                  </span> under the DPN regime.
                </>
              )}
            </p>
          </div>
        )
      })()}
    </div>
  )
}

// ─── Summary modal wrapper ────────────────────────────────────────────────────

function SummaryModal({
  analysis,
  onClose,
}: {
  analysis: LodgementAnalysisPayload
  onClose: () => void
}) {
  // Close on Escape and lock body scroll while open
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [onClose])

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-xl border border-border bg-surface shadow-2xl"
      >
        {/* Sticky close button */}
        <button
          onClick={onClose}
          aria-label="Close summary"
          className="absolute top-3 right-3 z-10 rounded-md p-1.5 text-foreground/50 hover:bg-primary/40 hover:text-foreground transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
        <SummaryPanel analysis={analysis} onClose={onClose} />
      </div>
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

  function getDaysSeverity(days: number): 'ok' | 'warning' | 'danger' {
    if (days === 0) return 'ok'
    if (days > 1000) return 'danger'
    return 'warning'
  }

  const countSeverity = analysis ? getSeverity(analysis.summary.numberOfLateLodgements) : 'ok'
  const daysSeverity = analysis ? getDaysSeverity(analysis.summary.cumulativeDaysLate) : 'ok'
  const lateRows = analysis ? analysis.rows.filter((r) => r.lateLodgeDaysCleaned > 0) : []

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-foreground/50" />
          <CardTitle>Lodgement Compliance Analysis With AI</CardTitle>
        </div>
        {analysis && (
          <div className="no-print flex items-center gap-2">
            <ExportPdfButton
              targetId="lodgement-export-root"
              fileName={`${analysis.sourceFilename.replace(/\.csv$/i, '')}_lodgement_analysis`}
            />
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
          {/* SBR Compliance */}
          <div className="grid grid-cols-2 gap-3">
            <StatTile
              value={analysis.summary.numberOfLateLodgements}
              label="Number of Late Lodgements"
              severity={countSeverity}
            />
            <StatTile
              value={analysis.summary.cumulativeDaysLate}
              label="Cumulative Days Late"
              severity={daysSeverity}
            />
          </div>

          {showSummary && (
            <SummaryModal analysis={analysis} onClose={() => setShowSummary(false)} />
          )}

          {/* DPN Risk */}
          {analysis.dpnRisk && (
            <div className="border-t border-border/40 pt-4">
              <DpnRiskPanel
                dpnRisk={analysis.dpnRisk}
                paymentRows={analysis.rows}
              />
            </div>
          )}

          {/* Debt Composition */}
          {analysis.debtBreakdown && (
            <div className="border-t border-border/40 pt-4">
              <DebtCompositionPanel debtBreakdown={analysis.debtBreakdown} />
            </div>
          )}

          {/* Contributing lodgements table (all late rows) */}
          {lateRows.length > 0 && (
            <div className="border-t border-border/40 pt-4">
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
          )}

          <p className="text-xs text-foreground/30">
            Analysed {formatDateRelative(analysis.analysedAt)} · Source: {analysis.sourceFilename}
          </p>

          {analysis.warnings.length > 0 && <WarningsList warnings={analysis.warnings} />}

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      )}
    </Card>
  )
}
