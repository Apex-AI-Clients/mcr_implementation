import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { ALL_SOURCES, SOURCE_META, leadRecordHref } from '@/lib/leads/constants'
import { RANGES, type RangeKey } from '@/lib/dashboard/range'
import { loadLeadsDashboard } from '@/lib/dashboard/load'
import type { LeadSource } from '@/types/leads'
import { cn } from '@/lib/utils'
import { DonutWithLegend, Funnel, StackedArea } from './charts'
import { EmptyNote, Panel, PanelTitle, Pill } from './Panel'
import { formatCount } from './format'

/** One colour per delivered source, the same in every chart. */
export const SOURCE_COLOR: Record<LeadSource, { text: string; bg: string }> = {
  facebook: { text: 'text-chart-1', bg: 'bg-chart-1' },
  website: { text: 'text-chart-2', bg: 'bg-chart-2' },
  google_form: { text: 'text-chart-3', bg: 'bg-chart-3' },
  manual: { text: 'text-chart-4', bg: 'bg-chart-4' },
}

/** Who to call: follow-ups by stage (each a filtered list), then the quietest leads. */
export async function FollowUpsPanel() {
  const d = await loadLeadsDashboard('d30')
  return (
    <section id="follow-ups" className="scroll-mt-6">
    <Panel className="gap-4">
      <PanelTitle
        title="Follow-ups due"
        badge={d.followUpsDue > 0 ? <Pill tone="warning">{formatCount(d.followUpsDue)}</Pill> : <Pill tone="success">All clear</Pill>}
        subtitle="Open leads nobody has noted, called, emailed or moved in 30+ days. Click a stage to open those leads."
      />

      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(170px,1fr))]">
        {d.followUpsByStage.map((s) => (
          <Link
            key={s.stage}
            href={s.href}
            className={cn(
              'group flex items-center justify-between gap-2 rounded-xl border p-3.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
              s.count > 0 ? 'border-warning/40 bg-warning/10 hover:bg-warning/15' : 'border-border bg-surface hover:border-accent/40',
            )}
          >
            <span className="flex flex-col gap-0.5">
              <span className={cn('text-2xl font-semibold tabular-nums', s.count > 0 ? 'text-warning' : 'text-foreground')}>{formatCount(s.count)}</span>
              <span className="text-[13px] text-muted">{s.label}</span>
            </span>
            <span className="flex items-center gap-0.5 text-xs font-semibold text-accent">
              Open
              <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
            </span>
          </Link>
        ))}
      </div>

      {d.followUps.length === 0 ? (
        <EmptyNote>Every open lead has been contacted in the last 30 days.</EmptyNote>
      ) : (
        <div className="flex flex-col">
          <span className="pb-1 text-xs font-semibold uppercase tracking-[0.06em] text-muted">Quiet the longest</span>
          <ul className="flex flex-col">
            {d.followUps.map((f) => (
              <li key={f.id} className="border-t border-border first:border-t-0">
                <Link
                  href={leadRecordHref(f.id)}
                  className="group -mx-2 flex items-center gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <Initials name={f.name} />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-sm font-semibold text-foreground group-hover:text-accent">{f.name}</span>
                    <span className="truncate text-xs text-muted">{f.meta}</span>
                  </div>
                  <Pill tone="neutral">{f.stage}</Pill>
                  <span className="hidden w-24 shrink-0 text-right text-xs font-semibold text-warning tabular-nums sm:block">{f.daysQuiet} days quiet</span>
                  <span className="flex shrink-0 items-center gap-0.5 text-xs font-semibold text-accent">
                    Open lead
                    <ChevronRight className="h-4 w-4" aria-hidden="true" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
    </section>
  )
}

/** Where leads come from and how far they get, over the chosen range. */
export async function LeadsCharts({ range }: { range: RangeKey }) {
  const d = await loadLeadsDashboard(range)
  const { phrase } = RANGES[range]
  const sources = ALL_SOURCES.map((s) => ({ source: s, label: SOURCE_META[s].label, ...SOURCE_COLOR[s] }))

  return (
    <>
      <div className="flex flex-wrap gap-5">
        <Panel className="flex-[2_1_560px]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <PanelTitle title="New leads over time" subtitle="How many came in, by source. Hover for the numbers." />
            <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
              {sources.map((s) => (
                <li key={s.source} className="flex items-center gap-1.5 text-[13px] text-muted">
                  <span className={`h-2.5 w-2.5 rounded-[3px] ${s.bg}`} aria-hidden="true" />
                  {s.label}
                </li>
              ))}
            </ul>
          </div>
          {d.newLeads === 0 ? (
            <EmptyNote>No new leads {phrase}.</EmptyNote>
          ) : (
            <StackedArea
              labels={d.series.labels}
              spans={d.series.spans}
              unit="new leads"
              series={sources.map((s) => ({ name: s.label, values: d.series.bySource[s.source], colorClass: s.text, swatchClass: s.bg }))}
              ariaLabel={`New leads by source, ${phrase}: ${d.bySource.map((s) => `${s.label} ${s.count}`).join(', ')}.`}
            />
          )}
        </Panel>

        <Panel className="flex-[1_1_320px]">
          <PanelTitle title="Where leads come from" subtitle={`Share of ${formatCount(d.newLeads)} new leads ${phrase}`} />
          <DonutWithLegend
            slices={d.bySource.map((s) => ({
              key: s.source,
              label: s.label,
              value: s.count,
              colorClass: SOURCE_COLOR[s.source].text,
              swatchClass: SOURCE_COLOR[s.source].bg,
            }))}
            caption="new leads"
            ariaLabel={`New leads by source: ${d.bySource.map((s) => `${s.label} ${s.count}`).join(', ')}`}
          />
          <div className="flex flex-col gap-2.5 border-t border-border pt-4">
            <span className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">Top Facebook campaigns</span>
            {d.campaigns.length === 0 ? (
              <span className="text-[13px] text-muted">No campaign leads in this period.</span>
            ) : (
              d.campaigns.map((c) => (
                <div key={c.name} className="flex flex-col gap-1.5">
                  <div className="flex justify-between gap-2 text-[13px]">
                    <span className="truncate text-muted" title={c.name}>
                      {c.name}
                    </span>
                    <span className="font-semibold text-foreground tabular-nums">{formatCount(c.count)}</span>
                  </div>
                  <div className="h-1 rounded bg-primary">
                    <div className="h-1 rounded bg-chart-1" style={{ width: `${(c.count / d.campaigns[0].count) * 100}%` }} />
                  </div>
                </div>
              ))
            )}
          </div>
        </Panel>
      </div>

      <Panel>
        <PanelTitle
          title="How far new leads got"
          subtitle={`Of the leads that came in ${phrase}, how many reached each stage. Hover a bar for the step-by-step rate.`}
        />
        <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
          <Funnel steps={d.funnel} />
          <div className="grid grid-cols-3 content-start gap-3 lg:grid-cols-1 lg:border-l lg:border-border lg:pl-6">
            <MiniStat value={d.contactLater} label="Parked: contact in 30 days" href="/leads?tab=contact-in-30-days" />
            <MiniStat value={d.closed} label="Closed without converting" />
            <MiniStat value={d.repeatEnquiries} label="Enquired again" />
          </div>
        </div>
      </Panel>
    </>
  )
}

function MiniStat({ value, label, href }: { value: number; label: string; href?: string }) {
  const body = (
    <>
      <span className="text-lg font-semibold text-foreground tabular-nums">{formatCount(value)}</span>
      <span className="text-xs text-muted">{label}</span>
    </>
  )
  return href ? (
    <Link href={href} className="flex flex-col gap-0.5 rounded hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
      {body}
    </Link>
  ) : (
    <div className="flex flex-col gap-0.5">{body}</div>
  )
}

export function Initials({ name }: { name: string }) {
  const letters = name
    .replace(/\b(pty|ltd|limited|the|trust)\b/gi, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/10 text-xs font-semibold text-accent" aria-hidden="true">
      {letters || '•'}
    </span>
  )
}
