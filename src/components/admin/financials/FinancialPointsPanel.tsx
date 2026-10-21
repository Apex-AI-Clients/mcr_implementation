import { ArrowRight } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { cn } from '@/lib/utils'
import { FINANCIAL_POINTS_INTRO, money, type FinancialPoint, type PointTone } from '@/lib/sbr/financialPoints'

const POINT_TONE: Record<PointTone, { badge: 'warning' | 'success' | 'muted'; edge: string }> = {
  concern: { badge: 'warning', edge: 'border-l-warning' },
  positive: { badge: 'success', edge: 'border-l-success' },
  neutral: { badge: 'muted', edge: 'border-l-border' },
}

/**
 * "What the financial statements show", below the comparison's summary:
 * facts by rule (financialPoints.ts), never AI text.
 *
 * One card per point, read at a glance: what it is about, which way it went,
 * and the figures oldest to newest. The full sentence is kept for screen
 * readers, so nothing in it is lost.
 */
export function FinancialPointsPanel({ points }: { points: FinancialPoint[] }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h3 className="text-sm font-semibold text-foreground">What the financial statements show</h3>
      <p className="mt-1 text-xs leading-relaxed text-foreground/55">{FINANCIAL_POINTS_INTRO}</p>
      {points.length > 0 ? (
        <ul className="mt-3 grid gap-3 sm:grid-cols-2">
          {points.map((point) => (
            <FinancialPointCard key={point.rule} point={point} />
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-foreground/60">Nothing stands out in the financial statements.</p>
      )}
    </div>
  )
}

function FinancialPointCard({ point }: { point: FinancialPoint }) {
  const { card } = point
  const tone = POINT_TONE[card.tone]
  return (
    <li className={cn('break-inside-avoid rounded-lg border border-l-4 border-border bg-surface/60 p-3', tone.edge)}>
      <p className="sr-only">{point.text}</p>
      <div aria-hidden="true">
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
          <p className="text-sm font-medium text-foreground">{card.title}</p>
          <Badge variant={tone.badge}>{card.verdict}</Badge>
        </div>

        {card.figures.length > 0 && (
          <div className="mt-2.5 flex flex-wrap items-end gap-x-2 gap-y-2">
            {card.figures.map((figure, i) => (
              <div key={figure.label} className="flex items-end gap-2">
                {i > 0 && <ArrowRight className="mb-1 h-3 w-3 shrink-0 text-foreground/30" />}
                <div>
                  <p className="text-[11px] leading-tight text-foreground/50">{figure.label}</p>
                  <p
                    className={cn(
                      'text-sm font-semibold tabular-nums',
                      figure.value < 0 ? 'text-destructive' : 'text-foreground',
                    )}
                  >
                    {money(figure.value)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}

        {card.note && <p className="mt-2 text-xs leading-relaxed text-foreground/55">{card.note}</p>}
      </div>
    </li>
  )
}
