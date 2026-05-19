import { cn } from '@/lib/utils'
import { TrendSparkline } from './TrendSparkline'
import { YoYBadge } from './YoYBadge'
import type { FinancialsComparison, Severity, YearRatios } from '@/lib/financials/types'

interface Props {
  comparison: FinancialsComparison
}

type RatioKey = keyof YearRatios

interface RatioConfig {
  key: RatioKey
  label: string
  /** How the value is presented in the tile. */
  formatter: (v: number) => string
  /** Severity bands. Receives the latest value. */
  severity: (latest: number | null) => Severity
  /** True if growth in this ratio is a NEGATIVE signal (e.g. ATO debt %).
   *  Drives the YoY badge sentiment. */
  invertSentiment: boolean
}

const FMT_PCT = (v: number) => `${Math.round(v)}%`
const FMT_NUM = (v: number) => v.toFixed(2)
const FMT_DAYS = (v: number) => `${Math.round(v)} days`

const RATIOS: RatioConfig[] = [
  {
    key: 'grossMarginPercent',
    label: 'Gross margin',
    formatter: FMT_PCT,
    severity: (v) => (v === null ? 'watch' : v > 35 ? 'good' : v >= 20 ? 'watch' : 'concern'),
    invertSentiment: false,
  },
  {
    key: 'atoDebtAsPercentOfRevenue',
    label: 'ATO debt as % of revenue',
    formatter: FMT_PCT,
    severity: (v) => (v === null ? 'watch' : v < 10 ? 'good' : v <= 20 ? 'watch' : 'concern'),
    invertSentiment: true,
  },
  {
    key: 'atoDebtAsPercentOfTotalLiabilities',
    label: 'ATO debt as % of liabilities',
    formatter: FMT_PCT,
    severity: (v) => (v === null ? 'watch' : v < 25 ? 'good' : v <= 50 ? 'watch' : 'concern'),
    invertSentiment: true,
  },
  {
    key: 'directorLoansAsPercentOfAssets',
    label: 'Director loans as % of assets',
    formatter: FMT_PCT,
    severity: (v) => (v === null ? 'watch' : v < 5 ? 'good' : v <= 10 ? 'watch' : 'concern'),
    invertSentiment: true,
  },
  {
    key: 'currentRatio',
    label: 'Current ratio',
    formatter: FMT_NUM,
    severity: (v) => (v === null ? 'watch' : v > 1.2 ? 'good' : v >= 0.8 ? 'watch' : 'concern'),
    invertSentiment: false,
  },
  {
    key: 'debtToAssetRatio',
    label: 'Debt-to-asset ratio',
    formatter: FMT_NUM,
    severity: (v) => (v === null ? 'watch' : v < 0.7 ? 'good' : v <= 1.0 ? 'watch' : 'concern'),
    invertSentiment: true,
  },
  {
    key: 'daysRevenueInAtoDebt',
    label: 'Days of revenue in ATO debt',
    formatter: FMT_DAYS,
    severity: (v) => (v === null ? 'watch' : v < 30 ? 'good' : v <= 60 ? 'watch' : 'concern'),
    invertSentiment: true,
  },
  {
    key: 'netAssetsToTotalLiabilities',
    label: 'Net assets to total liabilities',
    formatter: FMT_NUM,
    severity: (v) => (v === null ? 'watch' : v > 0.2 ? 'good' : v >= -0.2 ? 'watch' : 'concern'),
    invertSentiment: false,
  },
]

export function RatiosPanel({ comparison }: Props) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-foreground mb-3">Key Ratios</h3>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {RATIOS.map((cfg) => (
          <RatioTile key={cfg.key} comparison={comparison} cfg={cfg} />
        ))}
      </div>
    </div>
  )
}

function RatioTile({
  comparison,
  cfg,
}: {
  comparison: FinancialsComparison
  cfg: RatioConfig
}) {
  const { years, ratiosByYear } = comparison
  const trend = years.map((fy) => ratiosByYear[fy]?.[cfg.key] ?? null)
  const present = trend.filter((v): v is number => v !== null)
  const latest = present.length > 0 ? present[present.length - 1] : null
  const prev = present.length >= 2 ? present[present.length - 2] : null

  const yoy =
    prev !== null && latest !== null && prev !== 0
      ? ((latest - prev) / Math.abs(prev)) * 100
      : null

  const severity = cfg.severity(latest)
  const formatted = latest === null ? '—' : cfg.formatter(latest)

  return (
    <div
      className={cn('flex flex-col gap-1.5 rounded-lg border p-3', {
        'border-success/30 bg-success/5': severity === 'good',
        'border-warning/30 bg-warning/5': severity === 'watch',
        'border-destructive/30 bg-destructive/5': severity === 'concern',
      })}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] font-medium text-foreground/55 leading-tight">{cfg.label}</span>
        <YoYBadge percent={yoy} invertSentiment={cfg.invertSentiment} />
      </div>
      <div
        className={cn('text-lg font-bold tabular-nums leading-tight', {
          'text-success': severity === 'good',
          'text-warning': severity === 'watch',
          'text-destructive': severity === 'concern',
        })}
      >
        {formatted}
      </div>
      <TrendSparkline
        values={trend}
        className={cn({
          'text-success/70': severity === 'good',
          'text-warning/80': severity === 'watch',
          'text-destructive/80': severity === 'concern',
        })}
        width={100}
        height={20}
      />
    </div>
  )
}
