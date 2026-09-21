import { ALL_SOURCES, ALL_STAGES, AU_STATES, DATE_RANGES, DEBT_FLOORS } from './constants'
import { EMPTY_FILTERS, type LeadFilterState } from './filter'
import type { AuState, LeadSource, LeadStage } from '@/types/leads'

/**
 * The list's state, carried in the URL.
 *
 * The URL is the single source of truth for what the list shows now that
 * filtering and paging happen in the database: a page is linkable, the back
 * button works, and a refresh lands on the same rows. Nothing about the view
 * lives in React state except the search box's own keystrokes.
 *
 * Every value is validated on the way in. These params are typed by hand and
 * arrive from bookmarks, so an unknown stage has to fall back to "all" rather
 * than reach a query builder.
 */

/** Anything Next hands a page as `searchParams`. */
export type RawSearchParams = Record<string, string | string[] | undefined>

export interface LeadQuery {
  filters: LeadFilterState
  page: number
}

const PARAM = {
  search: 'q',
  stage: 'stage',
  state: 'state',
  source: 'source',
  debtFloor: 'debt',
  dateRange: 'added',
  followUpOnly: 'followup',
  sort: 'sort',
  page: 'page',
} as const

/** A repeated param (`?stage=a&stage=b`) keeps its first value rather than failing. */
function one(raw: string | string[] | undefined): string | null {
  if (Array.isArray(raw)) return raw.length ? raw[0] : null
  return raw ?? null
}

function oneOf<T extends string>(
  raw: string | string[] | undefined,
  allowed: readonly T[],
): T | null {
  const value = one(raw)
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : null
}

/** Read a list URL. Unknown or malformed values fall back to the default. */
export function parseLeadQuery(params: RawSearchParams): LeadQuery {
  const debtRaw = one(params[PARAM.debtFloor])
  // Only the floors the filter actually offers — an arbitrary ?debt=1 would
  // otherwise become a query nobody can reproduce from the UI.
  const debtFloor = DEBT_FLOORS.some((floor) => floor.value === debtRaw)
    ? Number(debtRaw)
    : null

  const pageRaw = Number.parseInt(one(params[PARAM.page]) ?? '', 10)

  return {
    filters: {
      search: (one(params[PARAM.search]) ?? '').slice(0, 200),
      stage: oneOf<LeadStage>(params[PARAM.stage], ALL_STAGES) ?? 'all',
      state: oneOf<AuState>(params[PARAM.state], AU_STATES) ?? 'all',
      source: oneOf<LeadSource>(params[PARAM.source], ALL_SOURCES) ?? 'all',
      debtFloor,
      dateRange:
        oneOf(
          params[PARAM.dateRange],
          DATE_RANGES.map((range) => range.value),
        ) ?? 'any',
      followUpOnly: one(params[PARAM.followUpOnly]) === '1',
      sort: one(params[PARAM.sort]) === 'debt' ? 'debt' : 'recent',
    },
    // Clamping against the real page count needs a row count, so that happens
    // in the query. Here it is only kept sane.
    page: Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1,
  }
}

/**
 * The query string for a list state. Defaults are omitted, so an unfiltered
 * first page is a bare `/leads` rather than nine empty params.
 */
export function buildLeadQuery(filters: LeadFilterState, page: number = 1): string {
  const params = new URLSearchParams()
  const search = filters.search.trim()

  if (search) params.set(PARAM.search, search)
  if (filters.stage !== 'all') params.set(PARAM.stage, filters.stage)
  if (filters.state !== 'all') params.set(PARAM.state, filters.state)
  if (filters.source !== 'all') params.set(PARAM.source, filters.source)
  if (filters.debtFloor !== null) params.set(PARAM.debtFloor, String(filters.debtFloor))
  if (filters.dateRange !== 'any') params.set(PARAM.dateRange, filters.dateRange)
  if (filters.followUpOnly) params.set(PARAM.followUpOnly, '1')
  if (filters.sort !== EMPTY_FILTERS.sort) params.set(PARAM.sort, filters.sort)
  if (page > 1) params.set(PARAM.page, String(page))

  return params.toString()
}

/** `/leads`, `/leads?page=3`, … — what the pagination links and filters point at. */
export function leadsHref(filters: LeadFilterState, page: number = 1): string {
  const query = buildLeadQuery(filters, page)
  return query ? `/leads?${query}` : '/leads'
}
