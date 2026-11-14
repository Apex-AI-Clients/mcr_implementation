import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'
import { Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tooltip } from '@/components/ui/Tooltip'
import { Sparkline } from './charts'
import { ScrollLink } from './ScrollLink'

/** A dashboard card. */
export function Panel({ id, className, children }: { id?: string; className?: string; children: React.ReactNode }) {
  return (
    <div id={id} className={cn('flex min-w-0 flex-col gap-5 rounded-2xl border border-border bg-card p-6 shadow-sm', className)}>
      {children}
    </div>
  )
}

export function PanelTitle({
  title,
  subtitle,
  badge,
  action,
}: {
  title: string
  subtitle?: React.ReactNode
  badge?: React.ReactNode
  action?: { href: string; label: string }
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-1">
        <h3 className="flex items-center gap-2 text-[15px] font-semibold text-foreground">
          {title}
          {badge}
        </h3>
        {subtitle && <p className="text-[13px] text-muted">{subtitle}</p>}
      </div>
      {action && (
        <Link
          href={action.href}
          className="shrink-0 whitespace-nowrap text-sm font-semibold text-accent hover:text-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
        >
          {action.label}
        </Link>
      )}
    </div>
  )
}

export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'destructive'

const TONE_TEXT: Record<Tone, string> = {
  neutral: 'text-foreground',
  accent: 'text-accent',
  success: 'text-success',
  warning: 'text-warning',
  destructive: 'text-destructive',
}

export function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  const bg: Record<Tone, string> = {
    neutral: 'bg-surface text-muted',
    accent: 'bg-accent/10 text-accent',
    success: 'bg-success/15 text-success',
    warning: 'bg-warning/15 text-warning',
    destructive: 'bg-destructive/10 text-destructive',
  }
  return (
    <span className={cn('inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold', bg[tone])}>
      {children}
    </span>
  )
}

/** A KPI tile: label + icon, the figure, a small note beside it, an optional sparkline, a footnote. */
export function StatTile({
  label,
  icon: Icon,
  value,
  tone = 'neutral',
  aside,
  spark,
  sparkLabels,
  sparkUnit,
  footnote,
  href,
  info,
}: {
  label: string
  icon: LucideIcon
  value: string
  tone?: Tone
  aside?: React.ReactNode
  spark?: readonly number[]
  /** Hover title per spark point: the period it covers. */
  sparkLabels?: readonly string[]
  /** Hover label for the value: "New leads". */
  sparkUnit?: string
  footnote?: React.ReactNode
  href?: string
  /** "How is this worked out?", behind an ⓘ beside the label. Not for a tile with `href` (a link can't hold it). */
  info?: React.ReactNode
}) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2 text-muted">
        <span className="flex items-center gap-1.5 text-[13px] font-medium">
          {label}
          {info && (
            <Tooltip
              content={info}
              interactive
              maxHeightClassName="max-h-[26rem]"
              className="inline-flex cursor-help rounded-full text-muted hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <Info className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="sr-only">How this figure is worked out</span>
            </Tooltip>
          )}
        </span>
        <Icon className="h-4 w-4" aria-hidden="true" />
      </div>
      <div className="flex flex-wrap items-baseline gap-2">
        <span className={cn('text-3xl font-semibold tracking-tight tabular-nums', TONE_TEXT[tone])}>{value}</span>
        {aside}
      </div>
      {spark && <Sparkline values={spark} labels={sparkLabels} unit={sparkUnit} tone={tone === 'neutral' ? 'accent' : tone} />}
      {footnote && <span className="text-xs text-muted">{footnote}</span>}
    </>
  )
  const cls = 'flex min-w-0 flex-col gap-2.5 rounded-2xl border border-border bg-card p-[18px] shadow-sm'
  const linkCls = cn(cls, 'transition-colors hover:border-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent')
  // "#follow-ups": a section of this page, scrolled to on every click (ScrollLink).
  if (href?.startsWith('#')) {
    return (
      <ScrollLink target={href.slice(1)} href={href} className={linkCls}>
        {body}
      </ScrollLink>
    )
  }
  return href ? (
    <Link href={href} className={cn(cls, 'transition-colors hover:border-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent')}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  )
}

/** A thin horizontal bar, 0–100. */
export function Meter({ pct, className }: { pct: number; className?: string }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-primary">
      <div className={cn('h-full rounded-full bg-accent', className)} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </div>
  )
}

/** An empty state inside a panel. */
export function EmptyNote({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted">{children}</p>
}
