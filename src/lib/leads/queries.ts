import { getSupabaseServerClient } from '@/lib/supabase/server'
import { toLead, toLeadActivity } from '@/lib/leads/rowMappers'
import { normalisePhone } from '@/lib/leads/format'
import { FOLLOW_UP_DAYS, OPEN_STAGES } from '@/lib/leads/followUp'
import { DATE_RANGES } from '@/lib/leads/constants'
import { LEADS_PAGE_SIZE, clampPage, pageCountFor, rangeFor } from '@/lib/leads/pagination'
import type { LeadFilterState } from '@/lib/leads/filter'
import type { Lead, LeadActivity } from '@/types/leads'

/**
 * Server-side reads for the CRM.
 *
 * Server-only: uses the service-role client, so none of this may be imported
 * into a client component.
 *
 * Filtering, sorting and paging travel together, in the database. They have
 * to: a filter applied in the browser to one page of ten rows would search ten
 * rows out of hundreds and report "no matches" for a lead that plainly exists.
 * So the whole of LeadFilterState is expressed here in SQL, and the list
 * component receives a page it never narrows further.
 *
 * Reads return empty rather than throwing — a CRM that renders empty with a
 * logged error beats a 500 on the workspace chooser, which would take the SBR
 * side down with it.
 */

const DAY_MS = 86_400_000

/**
 * Characters that would be read as PostgREST filter syntax rather than as
 * text. `or=` takes a comma-separated list inside parentheses, so a comma or a
 * bracket in a search term changes the shape of the query; `%` and `*` are
 * both ilike wildcards, and somebody typing one means the character.
 */
const UNSAFE_IN_OR = new Set(['"', '\\', '%', '*', '(', ')', ','])

function escapeForOr(term: string): string {
  return Array.from(term)
    .map((character) => (UNSAFE_IN_OR.has(character) ? ' ' : character))
    .join('')
    .trim()
}

/**
 * The subset of the Supabase builder these helpers touch.
 *
 * Structural, so the real builder satisfies it and the two callers can share
 * the filter logic without either naming PostgrestFilterBuilder's type
 * parameters or widening to `any`.
 */
export interface LeadsFilterable<T> {
  eq(column: string, value: unknown): T
  in(column: string, values: readonly unknown[]): T
  or(filters: string): T
  gte(column: string, value: unknown): T
  lt(column: string, value: unknown): T
  order(column: string, options: { ascending: boolean; nullsFirst?: boolean }): T
}

/** Apply every active filter. Shared by the page read and the export. */
export function withFilters<T extends LeadsFilterable<T>>(
  query: T,
  filters: LeadFilterState,
  now: Date,
): T {
  let built = query

  const term = escapeForOr(filters.search)
  if (term) {
    // Phone matches on digits alone, so "0402 915" finds "0402915338" —
    // normalisePhone runs on both sides, at ingest and here.
    const digits = normalisePhone(term)
    built = built.or(
      [
        `name.ilike."*${term}*"`,
        `email.ilike."*${term}*"`,
        `message.ilike."*${term}*"`,
        `phone.ilike."*${digits || term}*"`,
      ].join(','),
    )
  }

  if (filters.stage !== 'all') built = built.eq('stage', filters.stage)
  if (filters.state !== 'all') {
    // mightBeInState() in SQL: the state itself, or a grouping containing it.
    // filters.state is an AuState from searchParams' allow-list, so it is safe
    // inside the filter string.
    built = built.or(`state.eq.${filters.state},meta_state_options.cs.{${filters.state}}`)
  }
  if (filters.source !== 'all') built = built.eq('source', filters.source)

  if (filters.debtFloor !== null) {
    // The same overlap test as overlapsFloor(): an open-ended range qualifies
    // on its floor, a closed one on its ceiling. A lead that only said
    // "$150,000 or +" must appear under the $100k+ filter.
    const floor = filters.debtFloor
    built = built.or(`and(debt_max.is.null,debt_min.gte.${floor}),debt_max.gte.${floor}`)
  }

  const days = DATE_RANGES.find((range) => range.value === filters.dateRange)?.days ?? null
  if (days !== null) {
    built = built.gte('created_at', new Date(now.getTime() - days * DAY_MS).toISOString())
  }

  if (filters.followUpOnly) {
    // needsFollowUp() in SQL: still open, and nothing recorded against it for
    // the threshold. Uses followUp.ts's own constants so the two cannot drift.
    built = built
      .in('stage', OPEN_STAGES)
      .lt('last_action_at', new Date(now.getTime() - FOLLOW_UP_DAYS * DAY_MS).toISOString())
  }

  return built
}

/** Sort, matching filterLeads(): ties fall back to newest first. */
function withSort<T extends LeadsFilterable<T>>(query: T, sort: LeadFilterState['sort']): T {
  if (sort === 'debt') {
    // Unknown debt last, which is the order idx_leads_debt_min is built for.
    return query
      .order('debt_min', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
  }
  return query.order('created_at', { ascending: false })
}

export interface LeadsPage {
  leads: Lead[]
  /** Rows matching the filters — not rows on this page. */
  total: number
  /** The page actually served. May differ from the one asked for. */
  page: number
  pageCount: number
  pageSize: number
}

/**
 * One page of leads, filtered and sorted in the database.
 *
 * An out-of-range page serves the last real page rather than an empty table:
 * `?page=9` outlives the filter that made nine pages, and an empty screen
 * reads as "no leads" when it means "no page nine".
 */
export async function getLeadsPage(input: {
  filters: LeadFilterState
  page: number
  pageSize?: number
  now?: Date
}): Promise<LeadsPage> {
  const pageSize = input.pageSize ?? LEADS_PAGE_SIZE
  const now = input.now ?? new Date()
  const supabase = getSupabaseServerClient()

  function read(page: number) {
    const [from, to] = rangeFor(page, pageSize)
    const base = supabase.from('leads').select('*', { count: 'exact' })
    return withSort(withFilters(base, input.filters, now), input.filters.sort).range(from, to)
  }

  const first = await read(Math.max(1, input.page))
  if (first.error) {
    console.error('[getLeadsPage]', first.error.message)
    return { leads: [], total: 0, page: 1, pageCount: 1, pageSize }
  }

  const total = first.count ?? 0
  const pageCount = pageCountFor(total, pageSize)
  const page = clampPage(input.page, pageCount)

  // Only re-read when the page asked for was past the end and there is
  // something to show. The common path is a single round trip.
  if (page !== input.page && total > 0) {
    const retry = await read(page)
    if (retry.error) {
      console.error('[getLeadsPage] retry', retry.error.message)
      return { leads: [], total, page, pageCount, pageSize }
    }
    return { leads: (retry.data ?? []).map(toLead), total, page, pageCount, pageSize }
  }

  return { leads: (first.data ?? []).map(toLead), total, page, pageCount, pageSize }
}

/**
 * Every row matching the filters, for the CSV export.
 *
 * Read in chunks because PostgREST caps a response at its `max-rows` setting
 * (1000 by default) whether or not a range was asked for. A single unbounded
 * select would export the first thousand and present it as the lot, which is
 * the kind of quiet truncation an export must never do.
 */
export async function getLeadsForExport(
  filters: LeadFilterState,
  options: { chunkSize?: number; maxRows?: number; now?: Date } = {},
): Promise<Lead[]> {
  const chunkSize = options.chunkSize ?? 1000
  const maxRows = options.maxRows ?? 50_000
  const now = options.now ?? new Date()
  const supabase = getSupabaseServerClient()

  const all: Lead[] = []
  for (let from = 0; from < maxRows; from += chunkSize) {
    const base = supabase.from('leads').select('*')
    const { data, error } = await withSort(withFilters(base, filters, now), filters.sort).range(
      from,
      from + chunkSize - 1,
    )

    if (error) {
      console.error('[getLeadsForExport]', error.message)
      break
    }
    const rows = data ?? []
    all.push(...rows.map(toLead))
    if (rows.length < chunkSize) break
  }
  return all
}

/**
 * Activities for a set of leads, grouped by lead id — the CSV export's notes
 * column.
 *
 * Chunked twice over, for two different limits. The id list is split because
 * an `in.(...)` of fifty thousand uuids is a URL no server will accept, and
 * each chunk's rows are then paged because PostgREST caps a response at its
 * `max-rows` setting regardless. Either limit, hit silently, would drop notes
 * from an export that gave no sign anything was missing.
 */
export async function getActivitiesForLeads(
  leadIds: string[],
  options: { idsPerQuery?: number; chunkSize?: number } = {},
): Promise<Map<string, LeadActivity[]>> {
  const idsPerQuery = options.idsPerQuery ?? 200
  const chunkSize = options.chunkSize ?? 1000
  const byLead = new Map<string, LeadActivity[]>()
  if (leadIds.length === 0) return byLead

  const supabase = getSupabaseServerClient()

  for (let start = 0; start < leadIds.length; start += idsPerQuery) {
    const batch = leadIds.slice(start, start + idsPerQuery)

    for (let from = 0; ; from += chunkSize) {
      const { data, error } = await supabase
        .from('lead_activities')
        .select('*')
        .in('lead_id', batch)
        .order('created_at', { ascending: true })
        .range(from, from + chunkSize - 1)

      if (error) {
        console.error('[getActivitiesForLeads]', error.message)
        return byLead
      }

      const rows = data ?? []
      for (const row of rows) {
        const activity = toLeadActivity(row)
        const existing = byLead.get(activity.leadId)
        if (existing) existing.push(activity)
        else byLead.set(activity.leadId, [activity])
      }
      if (rows.length < chunkSize) break
    }
  }

  return byLead
}

/** One lead by id, or null when it does not exist. */
export async function getLeadById(id: string): Promise<Lead | null> {
  const supabase = getSupabaseServerClient()
  const { data, error } = await supabase.from('leads').select('*').eq('id', id).maybeSingle()

  if (error) {
    console.error('[getLeadById]', error.message)
    return null
  }
  return data ? toLead(data) : null
}

/** The timeline for one lead, newest first. */
export async function getActivitiesForLead(leadId: string): Promise<LeadActivity[]> {
  const supabase = getSupabaseServerClient()
  const { data, error } = await supabase
    .from('lead_activities')
    .select('*')
    .eq('lead_id', leadId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[getActivitiesForLead]', error.message)
    return []
  }
  return (data ?? []).map(toLeadActivity)
}

/**
 * The lead a client file was converted from — the "Converted from a lead" link
 * on the client record. Resolved here rather than by scanning a client-side
 * list, which only ever worked while the browser held every lead.
 */
export async function getLeadIdForClient(clientId: string): Promise<string | null> {
  const supabase = getSupabaseServerClient()
  const { data, error } = await supabase
    .from('leads')
    .select('id')
    .eq('converted_client_id', clientId)
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error('[getLeadIdForClient]', error.message)
    return null
  }
  return data?.id ?? null
}

/**
 * Open leads, counted in the database.
 *
 * `head: true` asks for the count without the rows: the workspace chooser
 * needs the number and nothing else, and reading every lead to call `.length`
 * on it was both wasteful and capped at 1000.
 */
export async function getOpenLeadCount(): Promise<number> {
  const supabase = getSupabaseServerClient()
  const { count, error } = await supabase
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .in('stage', OPEN_STAGES)

  if (error) {
    console.error('[getOpenLeadCount]', error.message)
    return 0
  }
  return count ?? 0
}
