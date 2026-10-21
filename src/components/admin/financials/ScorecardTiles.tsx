import { cn } from '@/lib/utils'
import { TrendSparkline } from './TrendSparkline'
import { currentPeriodLabel, currentPeriodName } from '@/lib/financials/periodLabels'
import type { FinancialsComparison, HeadlineKey, HeadlineMetric } from '@/lib/financials/types'

interface Props {
  comparison: FinancialsComparison
}

const TILE_ORDER: HeadlineKey[] = [
  'revenue',
  'netProfit',
  'netAssets',
  'atoDebtTrajectory',
  'directorLoanAccountNet',
]

/**
 * Values and trends only: no previous-year comparison (Gabby, 21 Oct). A
 * comparison built before the net loan account shows the receivable tile.
 */
export function ScorecardTiles({ comparison }: Props) {
  const cp = comparison.currentPeriod ?? null
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
      {TILE_ORDER.map((key) => {
        const metric = comparison.headlines[key] ?? (key === 'directorLoanAccountNet' ? comparison.headlines.directorLoansReceivable : undefined)
        if (!metric) return null
        return (
          <Tile
            key={key}
            metric={metric}
            currentPeriod={cp ? { name: currentPeriodName(cp), label: currentPeriodLabel(cp) } : null}
          />
        )
      })}
    </div>
  )
}

const AUD = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  maximumFractionDigits: 0,
})

function formatAud(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—'
  return AUD.format(v)
}

function Tile({
  metric,
  currentPeriod,
}: {
  metric: HeadlineMetric
  /** "FY2027 to date", and its full label for the hover. */
  currentPeriod: { name: string; label: string } | null
}) {
  const { label, formatted, trend, severity, currentPeriodValue } = metric
  const hasCurrentPeriod = currentPeriodValue !== undefined && currentPeriodValue !== null

  return (
    <div
      className={cn('flex flex-col gap-2 rounded-xl border p-4', {
        'border-success/30 bg-success/10': severity === 'good',
        'border-warning/30 bg-warning/10': severity === 'watch',
        'border-destructive/30 bg-destructive/10': severity === 'concern',
      })}
    >
      <span className="text-xs font-medium text-foreground/55 leading-tight">{label}</span>
      <div
        className={cn('text-xl font-bold tabular-nums leading-tight', {
          'text-success': severity === 'good',
          'text-warning': severity === 'watch',
          'text-destructive': severity === 'concern',
        })}
      >
        {formatted}
      </div>
      {hasCurrentPeriod && (
        <div className="text-[11px] text-foreground/50 tabular-nums leading-tight" title={currentPeriod?.label}>
          {currentPeriod?.name ?? 'Current period'}: <span className="text-foreground/70">{formatAud(currentPeriodValue)}</span>
        </div>
      )}
      <TrendSparkline
        values={trend}
        className={cn({
          'text-success/70': severity === 'good',
          'text-warning/80': severity === 'watch',
          'text-destructive/80': severity === 'concern',
        })}
        width={120}
        height={28}
      />
    </div>
  )
}
