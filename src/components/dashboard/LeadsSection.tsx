import Link from 'next/link'
import { ALL_SOURCES, SOURCE_META, leadRecordHref } from '@/lib/leads/constants'
import { RANGES, type RangeKey } from '@/lib/dashboard/range'
import { loadLeadsDashboard } from '@/lib/dashboard/load'
import type { LeadSource } from '@/types/leads'
import { DonutWithLegend, Funnel, StackedArea } from './charts'
import { EmptyNote, Panel, PanelTitle, Pill, SectionHeader } from './Panel'
import { formatCount } from './format'

/** One colour per delivered source, the same in every chart. */
export const SOURCE_COLOR: Record<LeadSource, { text: string; bg: string }> = {
  facebook: { text: 'text-chart-1', bg: 'bg-chart-1' },
  website: { text: 'text-chart-2', bg: 'bg-chart-2' },
  google_form: { text: 'text-chart-3', bg: 'bg-chart-3' },
  manual: { text: 'text-chart-4', bg: 'bg-chart-4' },
}

export async function LeadsSection({ range }: { range: RangeKey }) {
  const d = await loadLeadsDashboard(range)
  const { label, phrase } = RANGES[range]
  const sources = ALL_SOURCES.map((s) => ({ source: s, label: SOURCE_META[s].label, ...SOURCE_COLOR[s] }))

  return (
    <section aria-labelledby="leads-h" className="flex flex-col gap-4">
      <SectionHeader id="leads-h" title="Leads" note={label} href="/leads" linkLabel="Open CRM" />

      <div className="flex flex-wrap gap-5">
        {/* New leads over time */}
        <Panel className="flex-[2_1_560px]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <PanelTitle title="New leads over time" subtitle="By source" />
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

        {/* Share by source + top campaigns */}
        <Panel className="flex-[1_1_320px]">
          <PanelTitle title="Where leads come from" subtitle={`Share of ${formatCount(d.newLeads)} new leads`} />
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

      <div className="flex flex-wrap gap-5">
        {/* Pipeline */}
        <Panel className="flex-[1_1_380px]">
          <PanelTitle title="Pipeline" subtitle="How far this period’s new leads have moved" />
          <Funnel steps={d.funnel} />
          <div className="grid grid-cols-3 gap-3 border-t border-border pt-4">
            <MiniStat value={d.contactLater} label="Contact in 30 days" />
            <MiniStat value={d.closed} label="Closed" />
            <MiniStat value={d.repeatEnquiries} label="Repeat enquiries" />
          </div>
        </Panel>

        {/* Follow-ups due */}
        <Panel className="flex-[1.6_1_520px] gap-2 pb-3">
          <PanelTitle
            title="Follow-ups due"
            badge={d.followUpsDue > 0 ? <Pill tone="warning">{formatCount(d.followUpsDue)}</Pill> : undefined}
            subtitle="Open leads with no note, call, email or stage change in 30+ days"
            action={{ href: '/leads', label: 'View all' }}
          />
          {d.followUps.length === 0 ? (
            <EmptyNote>Every open lead has been contacted in the last 30 days.</EmptyNote>
          ) : (
            <ul className="flex flex-col">
              {d.followUps.map((f) => (
                <li key={f.id} className="border-t border-border first:border-t-0">
                  <Link
                    href={leadRecordHref(f.id)}
                    className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <Initials name={f.name} />
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-sm font-semibold text-foreground">{f.name}</span>
                      <span className="truncate text-xs text-muted">{f.meta}</span>
                    </div>
                    <Pill tone="neutral">{f.stage}</Pill>
                    <span className="w-24 shrink-0 text-right text-xs font-semibold text-warning tabular-nums">{f.daysQuiet} days quiet</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </section>
  )
}

function MiniStat({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-lg font-semibold text-foreground tabular-nums">{formatCount(value)}</span>
      <span className="text-xs text-muted">{label}</span>
    </div>
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
