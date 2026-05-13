'use client'

import { useState } from 'react'
import { ShieldAlert, ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import { AiSummaryCallout } from '@/components/admin/lodgement/AiSummaryCallout'
import type { DpnRiskBreakdown } from '@/lib/analysis/types'

const AUD = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  maximumFractionDigits: 0,
})

function formatAud(value: number): string {
  return AUD.format(value)
}

function formatIso(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-AU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

function netColorClass(net: number): string {
  if (net === 0) return 'text-success'
  if (net > 10000) return 'text-destructive'
  return 'text-warning'
}

function netBgClass(net: number): string {
  if (net === 0) return 'bg-success/10 border-success/20'
  if (net > 10000) return 'bg-destructive/10 border-destructive/20'
  return 'bg-warning/10 border-warning/20'
}

interface TileProps {
  label: string
  value: number
  colorClass?: string
  bgClass?: string
}

function MetricTile({ label, value, colorClass, bgClass }: TileProps) {
  return (
    <div className={cn('rounded-lg border p-4 text-center', bgClass ?? 'bg-surface/50 border-border/40')}>
      <p className={cn('text-2xl font-bold tabular-nums', colorClass ?? 'text-foreground')}>
        {formatAud(value)}
      </p>
      <p className="mt-1 text-xs text-foreground/50">{label}</p>
    </div>
  )
}

interface Props {
  dpnRisk: DpnRiskBreakdown
  aiSummary: string | null
  aiSummaryGeneratedAt: string | null
}

export function DpnRiskPanel({ dpnRisk, aiSummary, aiSummaryGeneratedAt }: Props) {
  const [expanded, setExpanded] = useState(false)
  const hasRows = dpnRisk.contributingRows.length > 0

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <ShieldAlert className="h-4 w-4 text-foreground/50" />
        <h3 className="text-sm font-semibold text-foreground">DPN Risk (&gt;90 days late)</h3>
        {dpnRisk.periodStart && dpnRisk.periodEnd && (
          <span className="text-xs text-foreground/40">
            {formatIso(dpnRisk.periodStart)} – {formatIso(dpnRisk.periodEnd)}
          </span>
        )}
      </div>

      {/* Three metric tiles */}
      <div className="grid grid-cols-3 gap-3">
        <MetricTile
          label="Gross debt >90 days late"
          value={dpnRisk.totalGrossLate}
          colorClass="text-foreground/80"
          bgClass="bg-surface/50 border-border/40"
        />
        <MetricTile
          label="Reversed by credits"
          value={dpnRisk.totalReversed}
          colorClass="text-success"
          bgClass="bg-success/10 border-success/20"
        />
        <MetricTile
          label="Net at risk"
          value={dpnRisk.totalNetAtRisk}
          colorClass={netColorClass(dpnRisk.totalNetAtRisk)}
          bgClass={`border ${netBgClass(dpnRisk.totalNetAtRisk)}`}
        />
      </div>

      {/* AI summary embedded here */}
      {aiSummary && (
        <AiSummaryCallout summary={aiSummary} generatedAt={aiSummaryGeneratedAt} />
      )}

      {/* Expandable contributing rows */}
      {hasRows && (
        <div>
          <button
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1 text-xs text-foreground/50 hover:text-foreground transition-colors"
          >
            {expanded ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
            {expanded ? 'Hide' : 'Show'} contributing rows ({dpnRisk.contributingRows.length})
          </button>

          {expanded && (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-left text-foreground/40">
                    <th className="pb-2 pr-4 font-medium">Processed</th>
                    <th className="pb-2 pr-4 font-medium">Period Ending</th>
                    <th className="pb-2 pr-4 font-medium text-right">Days Late</th>
                    <th className="pb-2 pr-4 font-medium text-right">Debit</th>
                    <th className="pb-2 font-medium text-right">Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {dpnRisk.contributingRows.map((r) => (
                    <tr key={r.rowIndex} className="border-b border-border/40 last:border-0">
                      <td className="py-1.5 pr-4 text-foreground/70 whitespace-nowrap">
                        {formatIso(r.processedDate)}
                      </td>
                      <td className="py-1.5 pr-4 text-foreground/70 whitespace-nowrap">
                        {formatIso(r.periodEnding)}
                      </td>
                      <td className={cn('py-1.5 pr-4 text-right font-semibold', {
                        'text-destructive': r.daysLate > 365,
                        'text-warning': r.daysLate > 0 && r.daysLate <= 365,
                      })}>
                        {r.daysLate}
                      </td>
                      <td className="py-1.5 pr-4 text-right text-foreground/70">
                        {r.debit > 0 ? formatAud(r.debit) : '—'}
                      </td>
                      <td className="py-1.5 text-right text-success">
                        {r.credit > 0 ? formatAud(r.credit) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
