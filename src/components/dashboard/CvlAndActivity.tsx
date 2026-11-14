import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { CVL_STATUSES, CVL_STATUS_LABELS, CVL_ORIGIN_LABELS, type CvlStatus } from '@/lib/cvl/cases'
import { loadCvlDashboard, loadRecentActivity } from '@/lib/dashboard/load'
import { CVL_DATE_LABELS, type ActivityTag, type CvlDateKind } from '@/lib/dashboard/portfolio'
import { formatDateRelative } from '@/lib/utils'
import { EmptyNote, Panel, PanelTitle, Pill, type Tone } from './Panel'
import { formatCount, plural } from './format'

const STATUS_NOTE: Record<CvlStatus, string> = {
  draft: 'Details being entered',
  forms_prepared: '509, 507A and 507B ready',
  printed: 'Printed, ready to send',
}

const STATUS_BAR: Record<CvlStatus, string> = {
  draft: 'bg-chart-4',
  forms_prepared: 'bg-accent',
  printed: 'bg-success',
}

const DATE_TONE: Record<CvlDateKind, Tone> = {
  appointment: 'accent',
  report: 'warning',
  report_return: 'neutral',
  summary: 'neutral',
}

const month = new Intl.DateTimeFormat('en-AU', { month: 'short', timeZone: 'UTC' })
const weekday = new Intl.DateTimeFormat('en-AU', { weekday: 'long', timeZone: 'UTC' })

function whenText(days: number): string {
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  return `In ${days} days`
}

export async function CvlSection() {
  const d = await loadCvlDashboard()
  if (!d) return null
  return (
    <section aria-label="CVL details" className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-5">
        <Panel className="flex-[1_1_380px]">
          <PanelTitle title="File status" subtitle={`ASIC forms 509, 507A and 507B · ${plural(d.formsGenerated, 'form')} generated`} />
          {d.activeFiles === 0 ? (
            <EmptyNote>No CVL files yet.</EmptyNote>
          ) : (
            <ol className="flex flex-col gap-4">
              {CVL_STATUSES.map((s, i) => (
                <li key={s} className="flex items-center gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface text-xs font-semibold text-muted">{i + 1}</span>
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <div className="flex items-baseline justify-between gap-2 text-[13px]">
                      <span className="font-medium text-foreground">
                        {CVL_STATUS_LABELS[s]} <span className="font-normal text-muted">· {STATUS_NOTE[s]}</span>
                      </span>
                      <span className="text-sm font-semibold text-foreground tabular-nums">{formatCount(d.byStatus[s])}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-primary">
                      <div className={`h-full rounded-full ${STATUS_BAR[s]}`} style={{ width: `${(d.byStatus[s] / d.activeFiles) * 100}%` }} />
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
          <div className="grid grid-cols-2 gap-3 border-t border-border pt-4">
            <div className="flex flex-col gap-0.5">
              <span className="text-lg font-semibold text-foreground tabular-nums">{formatCount(d.byOrigin.lead)}</span>
              <span className="text-xs text-muted">{CVL_ORIGIN_LABELS.lead}</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-lg font-semibold text-foreground tabular-nums">{formatCount(d.byOrigin.sbr_client)}</span>
              <span className="text-xs text-muted">{CVL_ORIGIN_LABELS.sbr_client}</span>
            </div>
          </div>
        </Panel>

        <Panel className="order-first flex-[1.6_1_520px] scroll-mt-6 gap-2 pb-3">
          <span id="cvl-dates" />
          <PanelTitle title="Upcoming dates" subtitle="Appointments, report and summary dates entered on CVL files, soonest first" action={{ href: '/cvl', label: 'All CVL files' }} />
          {d.upcoming.length === 0 ? (
            <EmptyNote>No upcoming dates entered on CVL files.</EmptyNote>
          ) : (
            <ul className="flex flex-col">
              {d.upcoming.map((u) => {
                const date = new Date(`${u.date}T00:00:00Z`)
                return (
                  <li key={`${u.clientId}-${u.kind}`} className="border-t border-border first:border-t-0">
                    <Link
                      href={`/cvl/${u.clientId}`}
                      className="group -mx-2 flex items-center gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      <span className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-xl border border-border leading-none">
                        <span className="text-[10px] font-semibold uppercase text-muted">{month.format(date)}</span>
                        <span className="text-base font-semibold text-foreground">{date.getUTCDate()}</span>
                      </span>
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="truncate text-sm font-semibold text-foreground group-hover:text-accent">{u.name}</span>
                        <span className="truncate text-xs text-muted">
                          {weekday.format(date)} · {CVL_ORIGIN_LABELS[u.origin].toLowerCase()}
                        </span>
                      </div>
                      <Pill tone={DATE_TONE[u.kind]}>{CVL_DATE_LABELS[u.kind]}</Pill>
                      <span className={`hidden w-20 shrink-0 text-right text-xs sm:block ${u.daysAway < 7 ? 'font-semibold text-warning' : 'text-muted'}`}>
                        {whenText(u.daysAway)}
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </Panel>
      </div>
    </section>
  )
}

const TAG_TONE: Record<ActivityTag, string> = {
  CRM: 'bg-accent/10 text-accent',
  SBR: 'bg-success/15 text-success',
  CVL: 'bg-warning/15 text-warning',
}

const ACTIVITY_EMPTY: Record<ActivityTag, string> = {
  CRM: 'No lead activity yet. New enquiries, notes and calls will show here.',
  SBR: 'No SBR activity yet. New files and uploaded documents will show here.',
  CVL: 'No CVL activity yet. New files and generated forms will show here.',
}

export async function RecentActivity({ tag }: { tag: ActivityTag }) {
  const events = await loadRecentActivity(tag)
  return (
    <section aria-labelledby={`act-${tag}`} className="flex flex-col gap-3">
      <h3 id={`act-${tag}`} className="text-[15px] font-semibold text-foreground">
        Recent activity
      </h3>
      <Panel className="gap-0 py-3">
        {events.length === 0 ? (
          <EmptyNote>{ACTIVITY_EMPTY[tag]}</EmptyNote>
        ) : (
          <ul className="flex flex-col">
            {events.map((e, i) => (
              <li key={i} className="border-t border-border first:border-t-0">
                <Link
                  href={e.href}
                  className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <span className={`flex h-8 w-12 shrink-0 items-center justify-center rounded-lg text-[11px] font-semibold ${TAG_TONE[e.tag]}`}>{e.tag}</span>
                  <p className="min-w-0 flex-1 truncate text-sm text-muted">
                    {e.who && <span className="font-semibold text-foreground">{e.who} </span>}
                    {e.what} <span className="font-medium text-foreground">{e.subject}</span>
                  </p>
                  <span className="shrink-0 text-xs text-muted">{formatDateRelative(e.at)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </section>
  )
}
