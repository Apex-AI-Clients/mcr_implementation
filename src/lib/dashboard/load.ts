import { cache } from 'react'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { selectAll } from '@/lib/supabase/selectAll'
import { getCompletenessSummary } from '@/lib/clients/completeness'
import { getCustomStages } from '@/lib/leads/customStages'
import { leadRecordHref, SOURCE_META } from '@/lib/leads/constants'
import { CATEGORY_META } from '@/lib/constants'
import { atoAccountsOverview, type AtoAccountAnalysisRow } from '@/lib/analysis/atoAccount/store'
import { loadReadiness } from '@/lib/sbr/loadReadiness'
import { readCvlStatus } from '@/lib/cvl/cases'
import { cvlEnabled } from '@/lib/cvl/flag'
import { sydneyToday } from '@/lib/dpn/view'
import type { Readiness } from '@/lib/sbr/readiness'
import type { EntityType, LeadActivityType, LeadSource, LeadStage } from '@/types/leads'
import { summariseLeads, type DashClientRef, type LeadsDashboard } from './leads'
import {
  mergeActivity,
  summariseCvl,
  summariseReadiness,
  summariseSbr,
  type ActivityEvent,
  type ActivityTag,
  type CvlDashboard,
  type DashAtoAccount,
  type ReadinessDashboard,
  type SbrDashboard,
} from './portfolio'
import type { RangeKey } from './range'

/**
 * Server-only. Reads what the home dashboard shows and hands it to the pure
 * summaries (leads.ts, portfolio.ts). Each loader is cached for the request, so
 * the sections that share rows read them once.
 *
 * Counts only leave this file; the rows stay on the server.
 */

/** An embedded to-one relation, as PostgREST returns it: an object, an array of one, or null. */
function one<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null)
}

/** Ids in chunks, for `.in()` filters that would otherwise make a URL too long. */
function chunks<T>(list: readonly T[], size = 200): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

interface ClientRow {
  id: string
  name: string
  created_at: string
  workflow: string
  archived_at: string | null
}

/** Every client file, archived ones too (conversions are dated by their file). */
const loadClients = cache(async (): Promise<ClientRow[]> => {
  const supabase = getSupabaseServerClient()
  return selectAll<ClientRow>((from, to) =>
    supabase.from('clients').select('id, name, created_at, workflow, archived_at').order('id').range(from, to),
  )
})

/** Active SBR files, as the Clients list counts them. */
const loadSbrFiles = cache(async () => {
  const clients = await loadClients()
  return clients
    .filter((c) => c.workflow === 'sbr' && !c.archived_at)
    .map((c) => ({ id: c.id, name: c.name, createdAt: c.created_at }))
})

// ── Leads ───────────────────────────────────────────────────────────────────

export const loadLeadsDashboard = cache(async (range: RangeKey): Promise<LeadsDashboard> => {
  const supabase = getSupabaseServerClient()
  const [leads, submissions, clients, stages] = await Promise.all([
    selectAll((from, to) =>
      supabase
        .from('leads')
        .select('id, name, company, source, stage, created_at, last_action_at, state, entity_type, debt_text, meta_campaign_name, converted_client_id')
        .order('id')
        .range(from, to),
    ),
    selectAll((from, to) =>
      supabase.from('lead_submissions').select('id, lead_id, received_at, converted_client_id').order('id').range(from, to),
    ),
    loadClients(),
    getCustomStages(),
  ])

  return summariseLeads({
    leads: leads.map((l) => ({
      id: l.id,
      name: l.name,
      company: l.company,
      source: l.source as LeadSource,
      stage: l.stage as LeadStage,
      createdAt: l.created_at,
      lastActionAt: l.last_action_at,
      state: l.state,
      entityType: (l.entity_type as EntityType | null) ?? null,
      debtText: l.debt_text,
      campaign: l.meta_campaign_name,
      convertedClientId: l.converted_client_id,
    })),
    submissions: submissions.map((s) => ({ leadId: s.lead_id, receivedAt: s.received_at, convertedClientId: s.converted_client_id })),
    clients: clients.map<DashClientRef>((c) => ({ id: c.id, createdAt: c.created_at, workflow: c.workflow === 'cvl' ? 'cvl' : 'sbr' })),
    stages,
    range,
    now: new Date(),
  })
})

// ── SBR ─────────────────────────────────────────────────────────────────────

const ATO_COLUMNS =
  'id, client_id, document_id, account_kind, account_label, balance, balance_date, analysed_at, needs_review, reviewed_at, entity_matches, unparsed_date_rows, rows'

/** Each active file's ATO accounts, as its ATO accounts panel shows them. */
const loadAtoAccounts = cache(async (): Promise<DashAtoAccount[]> => {
  const supabase = getSupabaseServerClient()
  const files = await loadSbrFiles()
  const names = new Map(files.map((f) => [f.id, f.name]))
  const rows: AtoAccountAnalysisRow[] = []
  for (const ids of chunks(files.map((f) => f.id))) {
    // `rows` is read so an older analysis with unreadable dates is still caught (store.ts).
    const { data, error } = await supabase.from('ato_account_analyses').select(ATO_COLUMNS).in('client_id', ids)
    if (error) throw new Error(error.message)
    rows.push(...((data ?? []) as unknown as AtoAccountAnalysisRow[]))
  }
  const byClient = new Map<string, AtoAccountAnalysisRow[]>()
  for (const r of rows) byClient.set(r.client_id, [...(byClient.get(r.client_id) ?? []), r])

  return [...byClient.entries()].flatMap(([clientId, list]) =>
    atoAccountsOverview(list).accounts.map((a) => ({
      clientId,
      clientName: names.get(clientId) ?? '',
      analysisId: a.id,
      kind: a.kind,
      label: a.label,
      balance: a.balance,
      needsReview: a.needsReview,
      reviewedAt: a.reviewedAt,
    })),
  )
})

export const loadSbrDashboard = cache(async (): Promise<SbrDashboard> => {
  const supabase = getSupabaseServerClient()
  const [clients, files, completeness, predictions, historical, ato, lodgements, notices] = await Promise.all([
    loadClients(),
    loadSbrFiles(),
    getCompletenessSummary(),
    selectAll((from, to) =>
      supabase
        .from('sbr_outcome_predictions')
        .select('id, client_id, predicted_outcome_percent, predicted_low_percent, predicted_high_percent, total_creditor_amount, comparable_case_ids')
        .order('id')
        .range(from, to),
    ),
    selectAll((from, to) => supabase.from('sbr_historical_cases').select('id, accepted').order('id').range(from, to)),
    loadAtoAccounts(),
    // Newest first, so the first row per file is its latest analysis.
    selectAll((from, to) =>
      supabase
        .from('lodgement_analyses')
        .select('id, client_id, analysed_at, number_of_late_lodgements, cumulative_days_late')
        .order('analysed_at', { ascending: false })
        .order('id')
        .range(from, to),
    ),
    selectAll((from, to) =>
      supabase.from('director_penalty_notices').select('id, client_id, notice_type, status').order('id').range(from, to),
    ),
  ])

  const latestLodgement = new Map<string, (typeof lodgements)[number]>()
  for (const l of lodgements) if (!latestLodgement.has(l.client_id)) latestLodgement.set(l.client_id, l)

  return summariseSbr({
    files,
    archivedFiles: clients.filter((c) => c.archived_at).length,
    completeness,
    predictions: predictions.map((p) => ({
      clientId: p.client_id,
      outcomePercent: Number(p.predicted_outcome_percent),
      lowPercent: Number(p.predicted_low_percent),
      highPercent: Number(p.predicted_high_percent),
      creditorTotal: p.total_creditor_amount === null ? null : Number(p.total_creditor_amount),
      comparableCaseIds: p.comparable_case_ids ?? [],
    })),
    historicalAccepted: new Map(historical.map((h) => [h.id, h.accepted])),
    ato,
    lodgements: [...latestLodgement.values()].map((l) => ({
      clientId: l.client_id,
      lateLodgements: Number(l.number_of_late_lodgements ?? 0),
      daysLate: Number(l.cumulative_days_late ?? 0),
    })),
    notices: notices.map((n) => ({ clientId: n.client_id, type: n.notice_type, status: n.status })),
    now: new Date(),
  })
})

/** Runs `work` over `items`, `limit` at a time. */
async function mapLimited<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const i = next++
      out[i] = await work(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

/**
 * The readiness checklist of every active file: the same loader as the
 * client page, so the dashboard can never disagree with it. The slowest part
 * of the page, so it streams in on its own.
 */
export const loadReadinessDashboard = cache(async (): Promise<ReadinessDashboard> => {
  const supabase = getSupabaseServerClient()
  const [files, ato] = await Promise.all([loadSbrFiles(), loadAtoAccounts()])
  const results = await mapLimited(files, 4, async (f) => {
    try {
      return { clientId: f.id, name: f.name, readiness: await loadReadiness(supabase, f.id) }
    } catch {
      // One file that cannot be read must not take the dashboard down.
      return null
    }
  })
  return summariseReadiness(
    results.filter((r): r is { clientId: string; name: string; readiness: Readiness } => r !== null),
    ato,
  )
})

// ── CVL ─────────────────────────────────────────────────────────────────────

export const loadCvlDashboard = cache(async (): Promise<CvlDashboard | null> => {
  if (!cvlEnabled()) return null
  const supabase = getSupabaseServerClient()
  const [cases, { count: formsGenerated }] = await Promise.all([
    selectAll((from, to) =>
      supabase
        .from('cvl_cases')
        .select('id, client_id, status, origin, created_at, appointment_date, report_date, report_return_date, summary_date, clients!inner(name)')
        // In CVL: not removed from it (0047), as the CVL list reads it.
        .is('removed_at', null)
        .order('id')
        .range(from, to),
    ),
    supabase.from('cvl_generated_documents').select('id', { count: 'exact', head: true }),
  ])
  return summariseCvl({
    cases: cases.map((c) => ({
      clientId: c.client_id,
      name: one(c.clients as { name: string } | { name: string }[] | null)?.name ?? '',
      status: readCvlStatus(c.status),
      origin: c.origin === 'sbr_client' ? 'sbr_client' : 'lead',
      createdAt: c.created_at,
      appointmentDate: c.appointment_date,
      reportDate: c.report_date,
      reportReturnDate: c.report_return_date,
      summaryDate: c.summary_date,
    })),
    formsGenerated: formsGenerated ?? 0,
    todayIso: sydneyToday(),
    now: new Date(),
  })
})

// ── Recent activity ─────────────────────────────────────────────────────────

const ACTIVITY_VERB: Record<LeadActivityType, string> = {
  note: 'added a note to',
  call: 'logged a call with',
  email: 'logged an email with',
  next_step: 'set a next step for',
  stage_change: 'changed the stage of',
}

type LeadName = { name: string; company: string | null }

function leadTitle(lead: LeadName | null): string {
  return lead ? lead.company?.trim() || lead.name : 'a lead'
}

/** A document category's label, short: "Financial Statements", not the full heading. */
function categoryLabel(category: string): string {
  const label = (CATEGORY_META as Record<string, { label: string } | undefined>)[category]?.label ?? 'Document'
  return label.replace(/\s*\(.*\)\s*$/, '')
}

/** What happened lately in one workspace, newest first. */
export const loadRecentActivity = cache(async (tag: ActivityTag, limit = 8): Promise<ActivityEvent[]> => {
  const supabase = getSupabaseServerClient()

  if (tag === 'CRM') {
    const [activities, enquiries] = await Promise.all([
      supabase
        .from('lead_activities')
        .select('lead_id, type, author, created_at, leads(name, company)')
        .order('created_at', { ascending: false })
        .limit(limit),
      supabase
        .from('lead_submissions')
        .select('lead_id, source, after_close, received_at, leads(name, company)')
        .order('received_at', { ascending: false })
        .limit(limit),
    ])
    const done: ActivityEvent[] = (activities.data ?? []).map((a) => ({
      who: a.author,
      what: ACTIVITY_VERB[a.type as LeadActivityType] ?? 'updated',
      subject: leadTitle(one(a.leads as LeadName | LeadName[] | null)),
      href: leadRecordHref(a.lead_id),
      tag: 'CRM',
      at: a.created_at,
    }))
    const arrived: ActivityEvent[] = (enquiries.data ?? []).map((e) => ({
      who: null,
      what: `${e.after_close ? 'Re-enquiry' : 'New enquiry'} (${SOURCE_META[e.source as LeadSource]?.label ?? 'Unknown source'}) from`,
      subject: leadTitle(one(e.leads as LeadName | LeadName[] | null)),
      href: leadRecordHref(e.lead_id),
      tag: 'CRM',
      at: e.received_at,
    }))
    return mergeActivity([done, arrived], limit)
  }

  if (tag === 'SBR') {
    const [files, documents] = await Promise.all([
      supabase.from('clients').select('id, name, created_at').eq('workflow', 'sbr').order('created_at', { ascending: false }).limit(limit),
      supabase
        .from('documents')
        .select('client_id, doc_category, uploaded_at, clients!inner(name, workflow)')
        .eq('clients.workflow', 'sbr')
        .neq('status', 'rejected')
        .order('uploaded_at', { ascending: false })
        .limit(limit),
    ])
    const opened: ActivityEvent[] = (files.data ?? []).map((c) => ({
      who: null,
      what: 'New SBR file opened for',
      subject: c.name,
      href: `/clients/${c.id}`,
      tag: 'SBR',
      at: c.created_at,
    }))
    const uploaded: ActivityEvent[] = (documents.data ?? []).map((d) => ({
      who: null,
      what: `${categoryLabel(d.doc_category)} uploaded for`,
      subject: one(d.clients as { name: string } | { name: string }[] | null)?.name ?? 'a client',
      href: `/clients/${d.client_id}`,
      tag: 'SBR',
      at: d.uploaded_at,
    }))
    return mergeActivity([opened, uploaded], limit)
  }

  if (!cvlEnabled()) return []
  const [cases, forms] = await Promise.all([
    supabase
      .from('cvl_cases')
      .select('client_id, origin, created_at, clients(name)')
      .is('removed_at', null)
      .order('created_at', { ascending: false })
      .limit(limit),
    supabase
      .from('cvl_generated_documents')
      .select('client_id, form_code, generated_by, generated_at, clients(name)')
      .order('generated_at', { ascending: false })
      .limit(limit),
  ])
  const opened: ActivityEvent[] = (cases.data ?? []).map((c) => ({
    who: null,
    what: c.origin === 'sbr_client' ? 'Moved from SBR to CVL:' : 'New CVL file opened for',
    subject: one(c.clients as { name: string } | { name: string }[] | null)?.name ?? 'a CVL file',
    href: `/cvl/${c.client_id}`,
    tag: 'CVL',
    at: c.created_at,
  }))
  const generated: ActivityEvent[] = (forms.data ?? []).map((f) => ({
    who: f.generated_by,
    what: `generated form ${f.form_code.toUpperCase()} for`,
    subject: one(f.clients as { name: string } | { name: string }[] | null)?.name ?? 'a CVL file',
    href: `/cvl/${f.client_id}`,
    tag: 'CVL',
    at: f.generated_at,
  }))
  return mergeActivity([opened, generated], limit)
})
