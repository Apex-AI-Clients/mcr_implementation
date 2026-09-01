import { describe, it, expect } from 'vitest'
import { EMPTY_FILTERS, filterLeads, hasActiveFilters, type LeadFilterState } from '../filter'
import type { Lead } from '@/types/leads'

const NOW = new Date('2026-09-01T02:00:00.000Z')
const DAY_MS = 86_400_000

function at(daysBefore: number): string {
  return new Date(NOW.getTime() - daysBefore * DAY_MS).toISOString()
}

function makeLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: 'ld_test',
    name: 'Test Lead',
    email: 'test@example.com.au',
    phone: '0402915338',
    debtAmount: 4_150_000,
    state: 'VIC',
    stage: 'lead',
    source: 'facebook',
    company: null,
    nextStep: null,
    stageSince: at(5),
    lastActionAt: at(5),
    convertedClientId: null,
    createdAt: at(5),
    updatedAt: at(5),
    ...overrides,
  }
}

function withFilters(patch: Partial<LeadFilterState>): LeadFilterState {
  return { ...EMPTY_FILTERS, ...patch }
}

describe('hasActiveFilters', () => {
  it('is false for the empty state', () => {
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false)
  })

  it('ignores whitespace-only search', () => {
    expect(hasActiveFilters(withFilters({ search: '   ' }))).toBe(false)
  })

  it.each([
    ['search', { search: 'marcus' }],
    ['stage', { stage: 'prospect' as const }],
    ['state', { state: 'NSW' as const }],
    ['source', { source: 'website' as const }],
    ['dateRange', { dateRange: '30' }],
    ['followUpOnly', { followUpOnly: true }],
  ])('is true when %s is set', (_label, patch) => {
    expect(hasActiveFilters(withFilters(patch))).toBe(true)
  })
})

describe('filterLeads', () => {
  const leads = [
    makeLead({ id: 'a', name: 'Marcus Oyelaran', email: 'marcus@brightpath.com.au', phone: '0402915338', state: 'VIC', stage: 'lead', source: 'facebook', createdAt: at(2), lastActionAt: at(2) }),
    makeLead({ id: 'b', name: 'Priya Raman', email: 'priya@freight.com.au', phone: '0433217604', state: 'NSW', stage: 'prospect', source: 'website', createdAt: at(10), lastActionAt: at(10) }),
    makeLead({ id: 'c', name: 'Sasha Lorenz', email: 'sasha@autoworks.com.au', phone: '0421004772', state: 'NSW', stage: 'lead', source: 'facebook', createdAt: at(40), lastActionAt: at(40) }),
    makeLead({ id: 'd', name: 'Hugo Pemberton', email: 'hugo@tiling.com.au', phone: '0417645099', state: 'VIC', stage: 'non_proceeding', source: 'website', createdAt: at(75), lastActionAt: at(75) }),
  ]

  function ids(result: Lead[]): string[] {
    return result.map((lead) => lead.id)
  }

  it('returns everything, newest first, with no filters', () => {
    expect(ids(filterLeads(leads, EMPTY_FILTERS, NOW))).toEqual(['a', 'b', 'c', 'd'])
  })

  it('matches search against name, email and phone', () => {
    expect(ids(filterLeads(leads, withFilters({ search: 'marcus' }), NOW))).toEqual(['a'])
    expect(ids(filterLeads(leads, withFilters({ search: 'freight' }), NOW))).toEqual(['b'])
    expect(ids(filterLeads(leads, withFilters({ search: '0421004772' }), NOW))).toEqual(['c'])
  })

  it('ignores phone formatting on both sides', () => {
    expect(ids(filterLeads(leads, withFilters({ search: '0402 915' }), NOW))).toEqual(['a'])
    expect(ids(filterLeads(leads, withFilters({ search: '+61402915338' }), NOW))).toEqual(['a'])
  })

  it('is case-insensitive', () => {
    expect(ids(filterLeads(leads, withFilters({ search: 'PRIYA' }), NOW))).toEqual(['b'])
  })

  it.each([
    [{ stage: 'lead' as const }, ['a', 'c']],
    [{ state: 'NSW' as const }, ['b', 'c']],
    [{ source: 'website' as const }, ['b', 'd']],
    [{ dateRange: '30' }, ['a', 'b']],
  ])('applies %o', (patch, expected) => {
    expect(ids(filterLeads(leads, withFilters(patch), NOW))).toEqual(expected)
  })

  it('shows only flagged leads when the follow-up toggle is on', () => {
    // c and d are past the threshold, but d is closed so it never flags.
    expect(ids(filterLeads(leads, withFilters({ followUpOnly: true }), NOW))).toEqual(['c'])
  })

  it('combines filters additively', () => {
    expect(
      ids(filterLeads(leads, withFilters({ state: 'NSW', source: 'facebook' }), NOW)),
    ).toEqual(['c'])
    expect(
      ids(filterLeads(leads, withFilters({ state: 'NSW', source: 'facebook', dateRange: '30' }), NOW)),
    ).toEqual([])
  })

  it('returns an empty array rather than throwing when nothing matches', () => {
    expect(filterLeads(leads, withFilters({ search: 'nobody' }), NOW)).toEqual([])
  })

  it('does not mutate the input array', () => {
    const original = [...leads]
    filterLeads(leads, EMPTY_FILTERS, NOW)
    expect(leads).toEqual(original)
  })
})
