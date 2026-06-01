import { cn } from '@/lib/utils'
import { TrendSparkline } from './TrendSparkline'
import { YoYBadge } from './YoYBadge'
import type { FinancialsComparison, HeadlineKey, HeadlineMetric } from '@/lib/financials/types'

interface Props {
  comparison: FinancialsComparison
}

const TILE_ORDER: HeadlineKey[] = [
  'revenue',
  'netProfit',
  'netAssets',
  'atoDebtTrajectory',
  'directorLoansReceivable',
]

/** Whether an INCREASE in this metric is a bad sign. ATO debt growing is bad;
 *  director loans growing is bad; revenue / net profit / net assets growing
 *  is good. Drives YoY badge sentiment. */
const INVERT_SENTIMENT: Record<HeadlineKey, boolean> = {
  revenue: false,
  netProfit: false,
  netAssets: false,
  atoDebtTrajectory: true,
  directorLoansReceivable: true,
}

export function ScorecardTiles({ comparison }: Props) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
      {TILE_ORDER.map((key) => (
        <Tile
          key={key}
          metric={comparison.headlines[key]}
          invertSentiment={INVERT_SENTIMENT[key]}
        />
      ))}
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

function Tile({ metric, invertSentiment }: { metric: HeadlineMetric; invertSentiment: boolean }) {
  const { label, formatted, trend, yoyPercent, severity, currentPeriodValue } = metric
  const hasCurrentPeriod = currentPeriodValue !== undefined && currentPeriodValue !== null

  return (
    <div
      className={cn('flex flex-col gap-2 rounded-xl border p-4', {
        'border-success/30 bg-success/10': severity === 'good',
        'border-warning/30 bg-warning/10': severity === 'watch',
        'border-destructive/30 bg-destructive/10': severity === 'concern',
      })}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-medium text-foreground/55 leading-tight">{label}</span>
        <YoYBadge percent={yoyPercent} invertSentiment={invertSentiment} />
      </div>
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
        <div className="text-[11px] text-foreground/50 tabular-nums leading-tight">
          Current YTD: <span className="text-foreground/70">{formatAud(currentPeriodValue)}</span>
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
