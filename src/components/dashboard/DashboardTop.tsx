import Link from 'next/link'
import {
  ArrowRight,
  Briefcase,
  CalendarClock,
  CheckCircle2,
  Clock,
  FileCheck2,
  FileText,
  Gavel,
  Landmark,
  LayoutGrid,
  Printer,
  UserPlus,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { cvlEnabled } from '@/lib/cvl/flag'
import { RANGES, RANGE_KEYS, type RangeKey } from '@/lib/dashboard/range'
import { loadCvlDashboard, loadLeadsDashboard, loadSbrDashboard } from '@/lib/dashboard/load'
import { Pill, StatTile } from './Panel'
import { formatChange, formatCount, formatMoneyShort, plural } from './format'

/** The dashboards on Home: one per workspace, or all of them down one page. */
export type DashboardView = 'all' | 'leads' | 'sbr' | 'cvl'

export function readView(value: string | string[] | undefined): DashboardView {
  const v = Array.isArray(value) ? value[0] : value
  if (v === 'all') return 'all'
  if (v === 'sbr') return 'sbr'
  if (v === 'cvl' && cvlEnabled()) return 'cvl'
  return 'leads'
}

export function viewHref(view: DashboardView, range?: RangeKey): string {
  const params = new URLSearchParams()
  if (view !== 'leads') params.set('view', view)
  // The range only means something where the Leads dashboard is shown.
  if ((view === 'leads' || view === 'all') && range && range !== 'd30') params.set('range', range)
  const q = params.toString()
  return q ? `/?${q}` : '/'
}

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

export function DashboardHeader({
  firstName,
  summary,
  controls,
}: {
  firstName: string | null
  summary: React.ReactNode
  /** Top right: the dashboard switcher. */
  controls?: React.ReactNode
}) {
  const now = new Date()
  return (
    <section className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium text-muted">{sydneyDate.format(now)}</span>
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          {greeting(now)}
          {firstName ? `, ${firstName}` : ''}
        </h1>
        <div className="min-h-[22px] text-[15px] text-muted">{summary}</div>
      </div>
      {controls}
    </section>
  )
}

/** "You have 23 follow-ups due and 2 CVL dates in the next 7 days." Each part links to its list. */
export async function HeaderSummary() {
  const [leads, cvl] = await Promise.all([loadLeadsDashboard('d30'), loadCvlDashboard()])
  const parts: React.ReactNode[] = []
  if (leads.followUpsDue > 0) {
    parts.push(
      <Link key="fu" href="/#follow-ups" className="font-semibold text-warning underline-offset-2 hover:underline">
        {plural(leads.followUpsDue, 'follow-up')} due
      </Link>,
    )
  }
  if (cvl && cvl.thisWeek > 0) {
    parts.push(
      <Link key="cvl" href="/?view=cvl#cvl-dates" className="font-semibold text-foreground underline-offset-2 hover:underline">
        {plural(cvl.thisWeek, 'CVL date')} in the next 7 days
      </Link>,
    )
  }
  if (parts.length === 0) return <p>Nothing is overdue today.</p>
  return (
    <p>
      You have {parts[0]}
      {parts[1] ? <> and {parts[1]}</> : null}.
    </p>
  )
}

export function RangePicker({ current, view = 'leads' }: { current: RangeKey; view?: DashboardView }) {
  return (
    <nav aria-label="Date range for lead figures" className="flex flex-wrap gap-0.5 rounded-xl border border-border bg-card p-1">
      {RANGE_KEYS.map((key) => {
        const on = key === current
        return (
          <Link
            key={key}
            href={viewHref(view, key)}
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

// ── Dashboard switcher ──────────────────────────────────────────────────────

interface SwitchDef {
  view: DashboardView
  label: string
  title: string
  icon: LucideIcon
}

function switches(): SwitchDef[] {
  const list: SwitchDef[] = [
    { view: 'all', label: 'All', title: 'Every dashboard, one after another', icon: LayoutGrid },
    { view: 'leads', label: 'Leads', title: 'New enquiries and follow-ups', icon: UserPlus },
    { view: 'sbr', label: 'SBR', title: 'Small Business Restructuring files', icon: Briefcase },
  ]
  if (cvlEnabled()) list.push({ view: 'cvl', label: 'CVL', title: 'Liquidation files and ASIC forms', icon: Gavel })
  return list
}

/** A small button group, top right: which dashboard to show. The range stays with it. */
export function DashboardSwitcher({ current, range }: { current: DashboardView; range: RangeKey }) {
  return (
    <nav aria-label="Dashboards" className="flex flex-wrap gap-0.5 rounded-xl border border-border bg-card p-1 shadow-sm">
      {switches().map((t) => {
        const on = t.view === current
        const Icon = t.icon
        return (
          <Link
            key={t.view}
            href={viewHref(t.view, range)}
            aria-current={on ? 'page' : undefined}
            title={t.title}
            scroll={false}
            className={cn(
              'flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
              on ? 'bg-accent font-semibold text-white' : 'font-medium text-muted hover:bg-surface hover:text-foreground',
            )}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            {t.label}
          </Link>
        )
      })}
    </nav>
  )
}

/** The dashboard's title row: what it is for, and the way into the workspace. */
export function ViewIntro({
  id,
  title,
  description,
  href,
  cta,
  controls,
}: {
  /** Anchor, so the All view can be jumped through. */
  id?: string
  title: string
  description: string
  href: string
  cta: string
  controls?: React.ReactNode
}) {
  return (
    <div id={id} className="flex scroll-mt-6 flex-wrap items-end justify-between gap-4 border-b border-border pb-4">
      <div className="flex max-w-2xl flex-col gap-1">
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h2>
        <p className="text-sm text-muted">{description}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {controls}
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

function KpiRow({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">{children}</div>
}

// ── KPI rows, one per dashboard ─────────────────────────────────────────────

export async function LeadsKpis({ range }: { range: RangeKey }) {
  const leads = await loadLeadsDashboard(range)
  const def = RANGES[range]
  const change = formatChange(leads.newLeadsChange)
  const convChange = def.comparison ? leads.conversions.total - leads.conversions.previous : 0

  return (
    <KpiRow>
      <StatTile
        label={`New leads · ${def.label.toLowerCase()}`}
        icon={UserPlus}
        value={formatCount(leads.newLeads)}
        aside={
          change && (
            <span className={cn('text-xs font-semibold', (leads.newLeadsChange ?? 0) >= 0 ? 'text-success' : 'text-destructive')}>{change}</span>
          )
        }
        spark={leads.series.totals}
        sparkLabels={leads.series.spans}
        sparkUnit="New leads"
        footnote={`${formatCount(leads.enquiries)} enquiries${def.comparison ? ` · ${def.comparison}` : ''}`}
        href="/leads"
      />
      <StatTile
        label="Follow-ups due now"
        icon={Clock}
        value={formatCount(leads.followUpsDue)}
        tone={leads.followUpsDue > 0 ? 'warning' : 'neutral'}
        aside={leads.followUpsDue > 0 ? <Pill tone="warning">Action needed</Pill> : <Pill tone="success">All clear</Pill>}
        footnote="Open leads with no contact in 30+ days · see the list below"
        href="#follow-ups"
      />
      <StatTile
        label={`Converted · ${def.label.toLowerCase()}`}
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
          cvlEnabled()
            ? `Became ${formatCount(leads.conversions.sbr)} SBR and ${formatCount(leads.conversions.cvl)} CVL files`
            : `Became ${plural(leads.conversions.sbr, 'SBR file')}`
        }
        href="/leads?tab=converted"
      />
      <StatTile
        label="Open leads now"
        icon={Users}
        value={formatCount(leads.openLeads)}
        footnote="Lead, prospect, client or contact in 30 days"
        href="/leads"
      />
    </KpiRow>
  )
}

export async function SbrKpis() {
  const sbr = await loadSbrDashboard()
  return (
    <KpiRow>
      <StatTile
        label="Active SBR files"
        icon={Briefcase}
        value={formatCount(sbr.activeFiles)}
        aside={<span className="text-xs font-semibold text-muted">+{formatCount(sbr.newInLast30Days)} in 30 days</span>}
        footnote={`${formatCount(sbr.archivedFiles)} archived files are not counted`}
        href="/clients"
      />
      <StatTile
        label="Documents collected"
        icon={FileText}
        value={formatCount(sbr.documents.total)}
        aside={<span className="text-xs font-semibold text-muted">{sbr.documents.overallPct}% of required</span>}
        footnote={`${formatCount(sbr.documents.complete)} files complete · ${formatCount(sbr.documents.awaiting)} still waiting`}
        href="/clients"
      />
      <StatTile
        label="Owed to creditors"
        icon={Landmark}
        value={formatMoneyShort(sbr.predictions.creditorTotal)}
        aside={<span className="text-xs font-semibold text-muted">AUD</span>}
        footnote={`Total creditors on ${plural(sbr.predictions.count, 'file')} with a prediction`}
      />
      <StatTile
        label="Owed to the ATO"
        icon={Landmark}
        value={formatMoneyShort(sbr.ato.total)}
        aside={<span className="text-xs font-semibold text-muted">AUD</span>}
        footnote={`From ATO account exports on ${plural(sbr.ato.filesWithBalance, 'file')}`}
      />
    </KpiRow>
  )
}

export async function CvlKpis() {
  const cvl = await loadCvlDashboard()
  if (!cvl) return null
  return (
    <KpiRow>
      <StatTile
        label="Active CVL files"
        icon={Gavel}
        value={formatCount(cvl.activeFiles)}
        aside={<span className="text-xs font-semibold text-muted">+{formatCount(cvl.newInLast30Days)} in 30 days</span>}
        footnote={`${formatCount(cvl.byOrigin.lead)} from leads · ${formatCount(cvl.byOrigin.sbr_client)} moved from SBR`}
        href="/cvl"
      />
      <StatTile
        label="Dates in the next 7 days"
        icon={CalendarClock}
        value={formatCount(cvl.thisWeek)}
        tone={cvl.thisWeek > 0 ? 'warning' : 'neutral'}
        footnote="Appointments, report and summary dates · see the list below"
        href="#cvl-dates"
      />
      <StatTile
        label="Forms prepared"
        icon={FileCheck2}
        value={formatCount(cvl.byStatus.forms_prepared)}
        footnote={`${formatCount(cvl.byStatus.draft)} files still in draft`}
        href="/cvl"
      />
      <StatTile
        label="Printed"
        icon={Printer}
        value={formatCount(cvl.byStatus.printed)}
        tone="success"
        footnote={`${plural(cvl.formsGenerated, 'form')} generated in total`}
        href="/cvl"
      />
    </KpiRow>
  )
}
