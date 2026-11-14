import Link from 'next/link'
import {
  ArrowRight,
  Briefcase,
  CheckCircle2,
  Clock,
  FileText,
  FolderOpen,
  Gavel,
  Landmark,
  UserPlus,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { cvlEnabled } from '@/lib/cvl/flag'
import { RANGES, RANGE_KEYS, type RangeKey } from '@/lib/dashboard/range'
import { loadCvlDashboard, loadLeadsDashboard, loadSbrDashboard } from '@/lib/dashboard/load'
import { Eyebrow, Pill, StatTile } from './Panel'
import { formatChange, formatCount, formatMoneyShort, plural } from './format'

const sydneyDate = new Intl.DateTimeFormat('en-AU', {
  timeZone: 'Australia/Sydney',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})
const sydneyHour = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', hour: 'numeric', hourCycle: 'h23' })

function greeting(now: Date): string {
  const hour = Number(sydneyHour.format(now))
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

// ── Header ──────────────────────────────────────────────────────────────────

export function DashboardHeader({ firstName, range, summary }: { firstName: string | null; range: RangeKey; summary: React.ReactNode }) {
  const now = new Date()
  return (
    <section className="flex flex-wrap items-end justify-between gap-5">
      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium text-muted">{sydneyDate.format(now)}</span>
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          {greeting(now)}
          {firstName ? `, ${firstName}` : ''}
        </h1>
        <div className="min-h-[22px] text-[15px] text-muted">{summary}</div>
      </div>
      <RangePicker current={range} />
    </section>
  )
}

function RangePicker({ current }: { current: RangeKey }) {
  return (
    <nav aria-label="Date range for lead figures" className="flex flex-wrap gap-0.5 rounded-xl border border-border bg-card p-1">
      {RANGE_KEYS.map((key) => {
        const on = key === current
        return (
          <Link
            key={key}
            href={key === 'd30' ? '/' : `/?range=${key}`}
            aria-current={on ? 'page' : undefined}
            scroll={false}
            className={cn(
              'flex h-9 items-center rounded-lg px-3.5 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
              on ? 'bg-accent font-semibold text-white' : 'font-medium text-muted hover:text-foreground',
            )}
          >
            {RANGES[key].short}
          </Link>
        )
      })}
    </nav>
  )
}

/** "You have 23 follow-ups due and 2 CVL dates this week." */
export async function HeaderSummary({ range }: { range: RangeKey }) {
  const [leads, cvl] = await Promise.all([loadLeadsDashboard(range), loadCvlDashboard()])
  const parts: React.ReactNode[] = []
  if (leads.followUpsDue > 0) {
    parts.push(
      <span key="fu" className="font-semibold text-warning">
        {plural(leads.followUpsDue, 'follow-up')} due
      </span>,
    )
  }
  if (cvl && cvl.thisWeek > 0) parts.push(<span key="cvl">{plural(cvl.thisWeek, 'CVL date')} in the next 7 days</span>)
  if (parts.length === 0) return <p>Nothing is overdue. {plural(leads.newLeads, 'new lead')} {RANGES[range].phrase}.</p>
  return (
    <p>
      You have {parts[0]}
      {parts[1] ? <> and {parts[1]}</> : null}.
    </p>
  )
}

// ── Workspace cards ─────────────────────────────────────────────────────────

function WorkspaceCard({
  icon: Icon,
  title,
  subtitle,
  value,
  valueTone,
  note,
  href,
  cta,
}: {
  icon: LucideIcon
  title: string
  subtitle: string
  value: string
  valueTone?: 'warning'
  note: string
  href: string
  cta: string
}) {
  return (
    <div className="flex flex-col gap-[18px] rounded-2xl border border-border bg-card p-[22px] shadow-sm">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-base font-semibold text-foreground">{title}</span>
          <span className="text-[13px] text-muted">{subtitle}</span>
        </div>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className={cn('text-[28px] font-semibold tracking-tight tabular-nums', valueTone === 'warning' ? 'text-warning' : 'text-foreground')}>
            {value}
          </span>
          <span className="text-[13px] text-muted">{note}</span>
        </div>
        <Link
          href={href}
          className="flex h-11 items-center gap-2 rounded-xl bg-accent px-[18px] text-sm font-semibold text-white transition-colors hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
        >
          {cta}
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>
    </div>
  )
}

export async function WorkspaceCards({ range }: { range: RangeKey }) {
  const [leads, sbr, cvl] = await Promise.all([loadLeadsDashboard(range), loadSbrDashboard(), loadCvlDashboard()])
  return (
    <section aria-labelledby="ws-h" className="flex flex-col gap-3.5">
      <Eyebrow id="ws-h">Workspaces</Eyebrow>
      <div className="grid gap-5 [grid-template-columns:repeat(auto-fit,minmax(280px,1fr))]">
        <WorkspaceCard
          icon={UserPlus}
          title="CRM · Leads"
          subtitle="Enquiries and follow-ups"
          value={formatCount(leads.openLeads)}
          note={`open leads · ${plural(leads.followUpsDue, 'follow-up')} due`}
          href="/leads"
          cta="Open CRM"
        />
        <WorkspaceCard
          icon={Briefcase}
          title="SBR · Small Business Restructuring"
          subtitle="Files, documents and outcome analysis"
          value={formatCount(sbr.activeFiles)}
          note={`active files · ${plural(sbr.documents.total, 'document')}`}
          href="/sbr"
          cta="Open SBR"
        />
        {cvl && (
          <WorkspaceCard
            icon={Gavel}
            title="CVL · Creditors’ Voluntary Liquidation"
            subtitle="Liquidation files and ASIC forms"
            value={formatCount(cvl.activeFiles)}
            note={`active files · ${plural(cvl.thisWeek, 'key date')} this week`}
            href="/cvl"
            cta="Open CVL"
          />
        )}
      </div>
    </section>
  )
}

// ── At a glance ─────────────────────────────────────────────────────────────

export async function KpiGrid({ range }: { range: RangeKey }) {
  const [leads, sbr, cvl] = await Promise.all([loadLeadsDashboard(range), loadSbrDashboard(), loadCvlDashboard()])
  const def = RANGES[range]
  const change = formatChange(leads.newLeadsChange)
  // All time has nothing before it to compare with.
  const convChange = def.comparison ? leads.conversions.total - leads.conversions.previous : 0

  return (
    <section aria-labelledby="kpi-h" className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <Eyebrow id="kpi-h">At a glance</Eyebrow>
        <span className="text-[13px] text-muted">Leads: {def.label.toLowerCase()} · SBR{cvlEnabled() ? ' and CVL' : ''}: as of today</span>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="New leads"
          icon={UserPlus}
          value={formatCount(leads.newLeads)}
          aside={
            change && (
              <span className={cn('text-xs font-semibold', (leads.newLeadsChange ?? 0) >= 0 ? 'text-success' : 'text-destructive')}>
                {change}
              </span>
            )
          }
          spark={leads.series.totals}
          sparkLabels={leads.series.spans}
          sparkUnit="New leads"
          footnote={`${formatCount(leads.enquiries)} enquiries${def.comparison ? ` · ${def.comparison}` : ''}`}
          href="/leads"
        />
        <StatTile
          label="Follow-ups due"
          icon={Clock}
          value={formatCount(leads.followUpsDue)}
          tone={leads.followUpsDue > 0 ? 'warning' : 'neutral'}
          aside={leads.followUpsDue > 0 ? <Pill tone="warning">Action needed</Pill> : <Pill tone="success">All clear</Pill>}
          footnote={`Of ${plural(leads.openLeads, 'open lead')} · no contact in 30+ days`}
          href="/leads"
        />
        <StatTile
          label="Leads converted"
          icon={CheckCircle2}
          value={formatCount(leads.conversions.total)}
          tone="success"
          aside={
            convChange !== 0 && (
              <span className={cn('text-xs font-semibold', convChange > 0 ? 'text-success' : 'text-destructive')}>
                {convChange > 0 ? '+' : '−'}
                {Math.abs(convChange)}
              </span>
            )
          }
          spark={leads.conversions.perBucket}
          sparkLabels={leads.series.spans}
          sparkUnit="Converted"
          footnote={
            cvl
              ? `${formatCount(leads.conversions.sbr)} to SBR · ${formatCount(leads.conversions.cvl)} to CVL`
              : `${formatCount(leads.conversions.sbr)} new SBR files`
          }
        />
        <StatTile
          label="Active SBR files"
          icon={Briefcase}
          value={formatCount(sbr.activeFiles)}
          aside={<span className="text-xs font-semibold text-muted">+{formatCount(sbr.newInLast30Days)} in 30 days</span>}
          footnote={`${formatCount(sbr.archivedFiles)} archived (not counted)`}
          href="/clients"
        />
        {cvl && (
          <StatTile
            label="Active CVL files"
            icon={Gavel}
            value={formatCount(cvl.activeFiles)}
            aside={<span className="text-xs font-semibold text-muted">+{formatCount(cvl.newInLast30Days)} in 30 days</span>}
            footnote={`${formatCount(cvl.byOrigin.lead)} from leads · ${formatCount(cvl.byOrigin.sbr_client)} from SBR`}
            href="/cvl"
          />
        )}
        <StatTile
          label="Documents collected"
          icon={FileText}
          value={formatCount(sbr.documents.total)}
          aside={<span className="text-xs font-semibold text-muted">{sbr.documents.overallPct}% of required</span>}
          footnote={`${formatCount(sbr.documents.complete)} files complete · ${formatCount(sbr.documents.awaiting)} awaiting`}
          href="/clients"
        />
        <StatTile
          label="Owed to creditors"
          icon={Landmark}
          value={formatMoneyShort(sbr.predictions.creditorTotal)}
          aside={<span className="text-xs font-semibold text-muted">AUD</span>}
          footnote={`Across ${plural(sbr.predictions.count, 'SBR file')} with a prediction`}
        />
        <StatTile
          label="Owed to the ATO"
          icon={FolderOpen}
          value={formatMoneyShort(sbr.ato.total)}
          aside={<span className="text-xs font-semibold text-muted">AUD</span>}
          footnote={`Across ${plural(sbr.ato.filesWithBalance, 'SBR file')} · from ATO account exports`}
        />
        {!cvl && (
          <StatTile
            label="Director penalty notices"
            icon={Users}
            value={formatCount(sbr.dpn.notices)}
            footnote={`On ${plural(sbr.dpn.files, 'file')}`}
          />
        )}
      </div>
    </section>
  )
}
