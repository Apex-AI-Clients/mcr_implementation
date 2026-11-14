import type { EntityType, LeadSource, LeadStage, StageSetting } from '@/types/leads'
import { ALL_SOURCES, ENTITY_TYPE_META, SOURCE_META, stageLabel } from '@/lib/leads/constants'
import { FOLLOW_UP_DAYS, isOpenStage } from '@/lib/leads/followUp'
import { bucketIndex, buckets, inWindow, windows, type RangeKey } from './range'

/**
 * The lead figures on the home dashboard. Pure: the rows come from
 * loadDashboard.ts, so the rules here are tested without a database.
 *
 * A "new lead" is a lead created in the range (one per person: 0020). An
 * enquiry is a lead_submissions row; a lead that enquires again adds an
 * enquiry, not a lead. A conversion is an enquiry that became a client file,
 * counted when that file was opened.
 */

export interface DashLead {
  id: string
  name: string
  company: string | null
  source: LeadSource
  stage: LeadStage
  createdAt: string
  lastActionAt: string
  state: string | null
  entityType: EntityType | null
  debtText: string | null
  campaign: string | null
  convertedClientId: string | null
}

export interface DashSubmission {
  leadId: string
  receivedAt: string
  convertedClientId: string | null
}

/** A client file, for dating conversions. */
export interface DashClientRef {
  id: string
  createdAt: string
  workflow: 'sbr' | 'cvl'
}

export interface FollowUpRow {
  id: string
  name: string
  meta: string
  stage: string
  daysQuiet: number
}

export interface SourceSlice {
  source: LeadSource
  label: string
  count: number
}

export interface FunnelStep {
  label: string
  count: number
  /** Of the first step, 0–100. */
  pct: number
}

export interface LeadsDashboard {
  newLeads: number
  previousNewLeads: number
  /** Percent change against the previous window; null when there were none before. */
  newLeadsChange: number | null
  /** New leads per bucket, per source (ALL_SOURCES order). */
  series: { labels: string[]; spans: string[]; bySource: Record<LeadSource, number[]>; totals: number[] }
  bySource: SourceSlice[]
  campaigns: { name: string; count: number }[]
  funnel: FunnelStep[]
  enquiries: number
  /** Enquiries in the range from people who had enquired before. */
  repeatEnquiries: number
  conversions: { total: number; sbr: number; cvl: number; previous: number; perBucket: number[] }
  /** Leads created in the range, now parked for 30 days. */
  contactLater: number
  /** Leads created in the range, now closed without converting. */
  closed: number
  /** Every lead still open, whenever created. */
  openLeads: number
  followUpsDue: number
  /** The quietest open leads, longest first. */
  followUps: FollowUpRow[]
}

const DAY_MS = 86_400_000

/** How far along the happy path a stage is: 0 lead, 1 prospect, 2 client, 3 converted; -1 off it. */
function pathStep(stage: LeadStage): number {
  return ({ lead: 0, prospect: 1, client: 2, converted: 3 } as Record<string, number>)[stage] ?? -1
}

function isConverted(lead: Pick<DashLead, 'stage' | 'convertedClientId'>): boolean {
  return lead.stage === 'converted' || lead.convertedClientId !== null
}

function changePct(now: number, before: number): number | null {
  if (before === 0) return null
  return Math.round(((now - before) / before) * 100)
}

function leadMeta(lead: DashLead): string {
  return [lead.entityType ? ENTITY_TYPE_META[lead.entityType]?.label : null, lead.state, lead.debtText, SOURCE_META[lead.source].label].filter(Boolean).join(' · ')
}

export function summariseLeads(input: {
  leads: readonly DashLead[]
  submissions: readonly DashSubmission[]
  clients: readonly DashClientRef[]
  stages: readonly StageSetting[]
  range: RangeKey
  now: Date
}): LeadsDashboard {
  const { leads, submissions, clients, stages, range, now } = input
  // All time starts at the first lead (or enquiry) on record.
  let since: string | null = null
  for (const t of [...leads.map((l) => l.createdAt), ...submissions.map((s) => s.receivedAt)]) {
    if (!since || Date.parse(t) < Date.parse(since)) since = t
  }
  const { current, previous } = windows(range, now, since)
  const list = buckets(range, now, since)

  // ── New leads, by source and over time ──────────────────────────────────
  const cohort = leads.filter((l) => inWindow(l.createdAt, current))
  const previousNewLeads = leads.filter((l) => inWindow(l.createdAt, previous)).length

  const bySourceSeries = Object.fromEntries(ALL_SOURCES.map((s) => [s, list.map(() => 0)])) as Record<LeadSource, number[]>
  for (const lead of cohort) {
    const i = bucketIndex(list, lead.createdAt)
    if (i >= 0 && bySourceSeries[lead.source]) bySourceSeries[lead.source][i]++
  }
  const totals = list.map((_, i) => ALL_SOURCES.reduce((sum, s) => sum + bySourceSeries[s][i], 0))

  const bySource = ALL_SOURCES.map((source) => ({
    source,
    label: SOURCE_META[source].label,
    count: cohort.filter((l) => l.source === source).length,
  }))

  const campaignCounts = new Map<string, number>()
  for (const lead of cohort) {
    if (lead.source !== 'facebook' || !lead.campaign?.trim()) continue
    const name = lead.campaign.trim()
    campaignCounts.set(name, (campaignCounts.get(name) ?? 0) + 1)
  }
  const campaigns = [...campaignCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 3)

  // ── Pipeline: how far this range's leads have got ───────────────────────
  // Each step counts the leads at that step or beyond. Leads that left the
  // path (unresponsive, not proceeding …) count in the first step only:
  // where they got to before is not recorded.
  const reached = (step: number) =>
    cohort.filter((l) => (isConverted(l) ? 3 : pathStep(l.stage)) >= step).length
  const first = cohort.length
  const funnel = [
    { label: 'New leads', count: first },
    { label: `${stageLabel('prospect', stages)} or further`, count: reached(1) },
    { label: `${stageLabel('client', stages)} or further`, count: reached(2) },
    { label: stageLabel('converted', stages), count: reached(3) },
  ].map((s) => ({ ...s, pct: first ? Math.round((s.count / first) * 100) : 0 }))

  const contactLater = cohort.filter((l) => l.stage === 'contact_in_30_days').length
  const closed = cohort.filter((l) => !isOpenStage(l.stage) && !isConverted(l)).length

  // ── Enquiries and conversions ───────────────────────────────────────────
  const firstEnquiry = new Map<string, number>()
  for (const s of submissions) {
    const t = new Date(s.receivedAt).getTime()
    const seen = firstEnquiry.get(s.leadId)
    if (seen === undefined || t < seen) firstEnquiry.set(s.leadId, t)
  }
  const inRange = submissions.filter((s) => inWindow(s.receivedAt, current))
  const repeatEnquiries = inRange.filter((s) => new Date(s.receivedAt).getTime() > (firstEnquiry.get(s.leadId) ?? Infinity)).length

  const clientById = new Map(clients.map((c) => [c.id, c]))
  const converted = submissions
    .map((s) => (s.convertedClientId ? clientById.get(s.convertedClientId) : undefined))
    .filter((c): c is DashClientRef => !!c)
  const convertedNow = converted.filter((c) => inWindow(c.createdAt, current))
  const perBucket = list.map(() => 0)
  for (const c of convertedNow) {
    const i = bucketIndex(list, c.createdAt)
    if (i >= 0) perBucket[i]++
  }

  // ── Follow-ups (whenever the lead came in) ──────────────────────────────
  const open = leads.filter((l) => isOpenStage(l.stage))
  const quiet = open
    .map((l) => ({ lead: l, days: Math.floor((now.getTime() - new Date(l.lastActionAt).getTime()) / DAY_MS) }))
    .filter((x) => now.getTime() - new Date(x.lead.lastActionAt).getTime() > FOLLOW_UP_DAYS * DAY_MS)
    .sort((a, b) => b.days - a.days)

  return {
    newLeads: cohort.length,
    previousNewLeads,
    newLeadsChange: changePct(cohort.length, previousNewLeads),
    series: { labels: list.map((b) => b.label), spans: list.map((b) => b.span), bySource: bySourceSeries, totals },
    bySource,
    campaigns,
    funnel,
    enquiries: inRange.length,
    repeatEnquiries,
    conversions: {
      total: convertedNow.length,
      sbr: convertedNow.filter((c) => c.workflow === 'sbr').length,
      cvl: convertedNow.filter((c) => c.workflow === 'cvl').length,
      previous: converted.filter((c) => inWindow(c.createdAt, previous)).length,
      perBucket,
    },
    contactLater,
    closed,
    openLeads: open.length,
    followUpsDue: quiet.length,
    followUps: quiet.slice(0, 5).map(({ lead, days }) => ({
      id: lead.id,
      name: lead.company?.trim() || lead.name,
      meta: leadMeta(lead),
      stage: stageLabel(lead.stage, stages),
      daysQuiet: days,
    })),
  }
}
