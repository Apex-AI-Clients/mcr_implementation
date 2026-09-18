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
    debtMin: 100_000,
    debtMax: 124_999,
    entityType: 'company',
    message: null,
    preferredCallTime: null,
    state: 'VIC',
    stage: 'lead',
    source: 'facebook',
    company: null,
    nextStep: null,
    stageSince: at(5),
    lastActionAt: at(5),
    convertedClientId: null,
    metaFormId: null,
    metaAdId: null,
    metaAdgroupId: null,
    metaPageId: null,
    metaCampaignId: null,
    metaCampaignName: null,
    metaAdName: null,
    metaAccountId: null,
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

  it('is false when only the sort order changed — that is not a filter', () => {
    expect(hasActiveFilters(withFilters({ sort: 'debt' }))).toBe(false)
  })

  it.each([
    ['search', { search: 'marcus' }],
    ['stage', { stage: 'prospect' as const }],
    ['state', { state: 'NSW' as const }],
    ['source', { source: 'website' as const }],
    ['debtFloor', { debtFloor: 250_000 }],
    ['dateRange', { dateRange: '30' }],
    ['followUpOnly', { followUpOnly: true }],
  ])('is true when %s is set', (_label, patch) => {
    expect(hasActiveFilters(withFilters(patch))).toBe(true)
  })
})

describe('filterLeads', () => {
  const leads = [
    // a: closed low bracket, b: open-ended $150k+, c: no debt given, d: big closed bracket
    makeLead({ id: 'a', name: 'Marcus Oyelaran', email: 'marcus@brightpath.com.au', phone: '0402915338', state: 'VIC', stage: 'lead', source: 'facebook', debtMin: 50_000, debtMax: 74_999, message: 'Behind on PAYG after losing a builder.', createdAt: at(2), lastActionAt: at(2) }),
    makeLead({ id: 'b', name: 'Priya Raman', email: 'priya@freight.com.au', phone: '0433217604', state: 'NSW', stage: 'prospect', source: 'website', debtMin: 150_000, debtMax: null, message: null, createdAt: at(10), lastActionAt: at(10) }),
    makeLead({ id: 'c', name: 'Sasha Lorenz', email: 'sasha@autoworks.com.au', phone: '0421004772', state: 'NSW', stage: 'lead', source: 'facebook', debtMin: null, debtMax: null, message: 'Saw your advertisement.', createdAt: at(40), lastActionAt: at(40) }),
    makeLead({ id: 'd', name: 'Hugo Pemberton', email: 'hugo@tiling.com.au', phone: '0417645099', state: 'VIC', stage: 'non_proceeding', source: 'website', debtMin: 250_000, debtMax: 500_000, message: null, createdAt: at(75), lastActionAt: at(75) }),
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

  it('matches search against the message — what people wrote is worth searching', () => {
    expect(ids(filterLeads(leads, withFilters({ search: 'PAYG' }), NOW))).toEqual(['a'])
    expect(ids(filterLeads(leads, withFilters({ search: 'advertisement' }), NOW))).toEqual(['c'])
  })

  it('does not fall over on a null message', () => {
    expect(ids(filterLeads(leads, withFilters({ search: 'nothing here' }), NOW))).toEqual([])
  })

  describe('debt floor', () => {
    it('includes an open-ended range under a lower floor', () => {
      // b is "$150k+", so it must appear under $100k+ as well as $150k+.
      expect(ids(filterLeads(leads, withFilters({ debtFloor: 100_000 }), NOW))).toEqual(['b', 'd'])
      expect(ids(filterLeads(leads, withFilters({ debtFloor: 150_000 }), NOW))).toEqual(['b', 'd'])
    })

    it('excludes an open-ended range above its own floor', () => {
      expect(ids(filterLeads(leads, withFilters({ debtFloor: 250_000 }), NOW))).toEqual(['d'])
      expect(ids(filterLeads(leads, withFilters({ debtFloor: 500_000 }), NOW))).toEqual(['d'])
    })

    it('includes a closed range whose top reaches the floor', () => {
      expect(ids(filterLeads(leads, withFilters({ debtFloor: 50_000 }), NOW))).toEqual(['a', 'b', 'd'])
    })

    it('never includes a lead with no debt recorded', () => {
      for (const floor of [50_000, 100_000, 500_000]) {
        expect(ids(filterLeads(leads, withFilters({ debtFloor: floor }), NOW))).not.toContain('c')
      }
    })

    it('combines with the other filters', () => {
      expect(
        ids(filterLeads(leads, withFilters({ debtFloor: 100_000, state: 'NSW' }), NOW)),
      ).toEqual(['b'])
      expect(
        ids(filterLeads(leads, withFilters({ debtFloor: 100_000, stage: 'lead' }), NOW)),
      ).toEqual([])
    })
  })

  describe('sort', () => {
    it('defaults to newest added first', () => {
      expect(ids(filterLeads(leads, EMPTY_FILTERS, NOW))).toEqual(['a', 'b', 'c', 'd'])
    })

    it('sorts by debt min descending with unknown debt last', () => {
      expect(ids(filterLeads(leads, withFilters({ sort: 'debt' }), NOW))).toEqual([
        'd', // 250k
        'b', // 150k
        'a', // 50k
        'c', // unknown
      ])
    })

    it('breaks debt ties by newest first rather than arbitrarily', () => {
      const tied = [
        makeLead({ id: 'x', debtMin: 100_000, debtMax: 124_999, createdAt: at(30) }),
        makeLead({ id: 'y', debtMin: 100_000, debtMax: 124_999, createdAt: at(1) }),
      ]
      expect(ids(filterLeads(tied, withFilters({ sort: 'debt' }), NOW))).toEqual(['y', 'x'])
    })
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
