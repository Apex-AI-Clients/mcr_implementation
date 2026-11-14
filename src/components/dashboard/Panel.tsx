import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Sparkline } from './charts'

/** A dashboard card. */
export function Panel({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-5 rounded-2xl border border-border bg-card p-6 shadow-sm', className)}>
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

/** "LEADS · Last 30 days ……… Open CRM ↗" */
export function SectionHeader({
  id,
  title,
  note,
  href,
  linkLabel,
}: {
  id: string
  title: string
  note?: string
  href: string
  linkLabel: string
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 id={id} className="text-xl font-semibold tracking-tight text-foreground">
          {title}
        </h2>
        {note && <span className="text-sm text-muted">{note}</span>}
      </div>
      <Link
        href={href}
        className="flex min-h-11 items-center gap-1.5 rounded text-sm font-semibold text-accent hover:text-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {linkLabel}
        <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </div>
  )
}

export function Eyebrow({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="text-[13px] font-semibold uppercase tracking-[0.08em] text-muted">
      {children}
    </h2>
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
}) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2 text-muted">
        <span className="text-[13px] font-medium">{label}</span>
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
