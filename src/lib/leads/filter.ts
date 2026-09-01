import type { AuState, Lead, LeadSource, LeadStage } from '@/types/leads'
import { needsFollowUp } from './followUp'
import { normalisePhone } from './format'

/**
 * List filtering. Pure so it can be tested without mounting the table, and so
 * the CSV export can reuse exactly what's on screen.
 */

export interface LeadFilterState {
  search: string
  stage: LeadStage | 'all'
  state: AuState | 'all'
  source: LeadSource | 'all'
  /** Days back from now, or 'any'. Applies to date added. */
  dateRange: string
  followUpOnly: boolean
}

export const EMPTY_FILTERS: LeadFilterState = {
  search: '',
  stage: 'all',
  state: 'all',
  source: 'all',
  dateRange: 'any',
  followUpOnly: false,
}

/** Whether anything is narrowing the view — drives the clear control and count. */
export function hasActiveFilters(filters: LeadFilterState): boolean {
  return (
    filters.search.trim() !== '' ||
    filters.stage !== 'all' ||
    filters.state !== 'all' ||
    filters.source !== 'all' ||
    filters.dateRange !== 'any' ||
    filters.followUpOnly
  )
}

function matchesSearch(lead: Lead, rawTerm: string): boolean {
  const term = rawTerm.trim().toLowerCase()
  if (!term) return true
  if (lead.name.toLowerCase().includes(term)) return true
  if (lead.email.toLowerCase().includes(term)) return true

  // Phone matching ignores formatting on both sides, so "0402 915" and
  // "0402915" both find the same lead.
  const phoneDigits = normalisePhone(lead.phone)
  const termDigits = normalisePhone(term)
  if (termDigits && phoneDigits.includes(termDigits)) return true
  return lead.phone.toLowerCase().includes(term)
}

/** Filters are additive — every active one must pass. Newest first. */
export function filterLeads(
  leads: Lead[],
  filters: LeadFilterState,
  now: Date = new Date(),
): Lead[] {
  const days = filters.dateRange === 'any' ? null : Number.parseInt(filters.dateRange, 10)
  const cutoff =
    days && Number.isFinite(days) ? now.getTime() - days * 86_400_000 : null

  return leads
    .filter((lead) => {
      if (!matchesSearch(lead, filters.search)) return false
      if (filters.stage !== 'all' && lead.stage !== filters.stage) return false
      if (filters.state !== 'all' && lead.state !== filters.state) return false
      if (filters.source !== 'all' && lead.source !== filters.source) return false
      if (cutoff !== null && new Date(lead.createdAt).getTime() < cutoff) return false
      if (filters.followUpOnly && !needsFollowUp(lead, now)) return false
      return true
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}
