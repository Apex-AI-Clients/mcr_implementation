import { describe, it, expect } from 'vitest'
import { buildLeadQuery, leadsHref, parseLeadQuery } from '../searchParams'
import { EMPTY_FILTERS, type LeadFilterState } from '../filter'

/**
 * The URL is the contract between the list and the database query, and it is
 * typed by hand, bookmarked, and edited. So the parsing half is tested the way
 * any untrusted input is: every value that reaches a query builder has to come
 * off an allow-list, and anything else has to fall back rather than pass
 * through.
 */

function filters(overrides: Partial<LeadFilterState> = {}): LeadFilterState {
  return { ...EMPTY_FILTERS, ...overrides }
}

describe('parseLeadQuery', () => {
  it('reads a full URL', () => {
    const { filters: parsed, page } = parseLeadQuery({
      q: 'whitlock',
      tab: 'prospects',
      state: 'QLD',
      source: 'Facebook',
      debt: '150000',
      added: '30',
      followup: '1',
      sort: 'debt',
      per: '50',
      page: '3',
    })

    expect(parsed).toEqual({
      search: 'whitlock',
      view: 'prospects',
      state: 'QLD',
      source: 'Facebook',
      debtFloor: 150_000,
      dateRange: '30',
      followUpOnly: true,
      sort: 'debt',
      perPage: 50,
    })
    expect(page).toBe(3)
  })

  it('defaults an empty URL to an unfiltered first page', () => {
    const { filters: parsed, page } = parseLeadQuery({})
    // It opens on the Leads tab.
    expect(parsed).toEqual({ ...EMPTY_FILTERS, view: 'leads' })
    expect(page).toBe(1)
  })

  it('falls back rather than passing an unknown value to the query', () => {
    // Each of these would otherwise reach a .eq() and either match nothing or
    // error, for a URL nobody can reproduce from the UI.
    const { filters: parsed } = parseLeadQuery({
      tab: 'archived',
      state: 'Auckland',
      added: 'forever',
      sort: 'name',
    })

    expect(parsed.view).toBe('leads')
    expect(parsed.state).toBe('all')
    expect(parsed.dateRange).toBe('any')
    expect(parsed.sort).toBe('recent')
  })

  it('only accepts a debt floor the filter actually offers', () => {
    expect(parseLeadQuery({ debt: '100000' }).filters.debtFloor).toBe(100_000)
    // A floor of $1 is not a choice the UI can make, so it is not one the URL
    // can make either.
    expect(parseLeadQuery({ debt: '1' }).filters.debtFloor).toBeNull()
    expect(parseLeadQuery({ debt: 'lots' }).filters.debtFloor).toBeNull()
  })

  it('treats the follow-up flag as strictly opt-in', () => {
    expect(parseLeadQuery({ followup: '1' }).filters.followUpOnly).toBe(true)
    expect(parseLeadQuery({ followup: 'true' }).filters.followUpOnly).toBe(false)
    expect(parseLeadQuery({ followup: '0' }).filters.followUpOnly).toBe(false)
  })

  it('survives junk in the page param', () => {
    expect(parseLeadQuery({ page: 'abc' }).page).toBe(1)
    expect(parseLeadQuery({ page: '0' }).page).toBe(1)
    expect(parseLeadQuery({ page: '-4' }).page).toBe(1)
    // Out of range is left alone here — only the row count can decide that,
    // so getLeadsPage clamps it.
    expect(parseLeadQuery({ page: '9999' }).page).toBe(9999)
  })

  it('takes the first of a repeated param instead of failing', () => {
    // ?state=NSW&state=VIC arrives as an array.
    expect(parseLeadQuery({ state: ['NSW', 'VIC'] }).filters.state).toBe('NSW')
    expect(parseLeadQuery({ state: [] }).filters.state).toBe('all')
  })

  it('takes any source by name, trimmed and capped (the options come from the data)', () => {
    expect(parseLeadQuery({ source: '  Referral — Dave ' }).filters.source).toBe('Referral — Dave')
    expect(parseLeadQuery({ source: 'x'.repeat(300) }).filters.source).toHaveLength(100)
    expect(parseLeadQuery({ source: '   ' }).filters.source).toBe('all')
  })

  it('ignores the old stage param: each stage has its own screen', () => {
    expect(parseLeadQuery({ stage: 'prospect' }).filters).toEqual({ ...EMPTY_FILTERS, view: 'leads' })
  })

  it('caps the search term', () => {
    const long = 'x'.repeat(500)
    expect(parseLeadQuery({ q: long }).filters.search).toHaveLength(200)
  })
})

describe('buildLeadQuery', () => {
  it('writes only what is not a default', () => {
    // An unfiltered first page is a bare /leads, not nine empty params.
    expect(buildLeadQuery(EMPTY_FILTERS, 1)).toBe('')
  })

  it('omits page 1 but keeps the rest', () => {
    expect(buildLeadQuery(filters({ state: 'NSW' }), 1)).toBe('state=NSW')
    expect(buildLeadQuery(filters({ state: 'NSW' }), 4)).toBe('state=NSW&page=4')
  })

  it('trims a search term and drops one that is only spaces', () => {
    expect(buildLeadQuery(filters({ search: '  civil  ' }), 1)).toBe('q=civil')
    expect(buildLeadQuery(filters({ search: '   ' }), 1)).toBe('')
  })

  it('escapes what it puts in the URL', () => {
    const query = buildLeadQuery(filters({ search: 'a&b=c d' }), 1)
    expect(query).toBe('q=a%26b%3Dc+d')
    // And survives the round trip intact, which is the point of escaping it.
    expect(parseLeadQuery(Object.fromEntries(new URLSearchParams(query))).filters.search).toBe(
      'a&b=c d',
    )
  })

  it('round-trips every filter', () => {
    const original = filters({
      search: 'whitlock',
      view: 'prospects',
      state: 'QLD',
      source: 'Website',
      debtFloor: 250_000,
      dateRange: '7',
      followUpOnly: true,
      sort: 'debt',
    })

    const parsed = parseLeadQuery(
      Object.fromEntries(new URLSearchParams(buildLeadQuery(original, 5))),
    )
    expect(parsed.filters).toEqual(original)
    expect(parsed.page).toBe(5)
  })
})

describe('leadsHref', () => {
  it('is a bare path when there is nothing to say', () => {
    expect(leadsHref(EMPTY_FILTERS, 1)).toBe('/leads')
  })

  it('carries the filters into a page link', () => {
    // A page link that drops the filter silently widens the result set.
    expect(leadsHref(filters({ state: 'NSW' }), 3)).toBe('/leads?state=NSW&page=3')
  })

  it('names the tab in the URL, so it can be bookmarked; Leads needs none', () => {
    expect(leadsHref(filters({ view: 'clients', state: 'NSW' }), 2)).toBe('/leads?tab=clients&state=NSW&page=2')
    expect(leadsHref(filters({ view: 'do_not_contact' }), 1)).toBe('/leads?tab=do-not-contact')
    expect(leadsHref(filters({ view: 'leads' }), 1)).toBe('/leads')
    expect(parseLeadQuery({ tab: 'non-proceeding' }).filters.view).toBe('non_proceeding')
  })
})

describe('per page', () => {
  it('defaults to 10 and leaves it out of the URL', () => {
    expect(parseLeadQuery({}).filters.perPage).toBe(10)
    expect(leadsHref(filters({ perPage: 10 }), 1)).toBe('/leads')
  })

  it('round-trips each size the control offers', () => {
    for (const perPage of [50, 100, 'all'] as const) {
      const href = leadsHref(filters({ perPage }), 1)
      const query = Object.fromEntries(new URLSearchParams(href.split('?')[1]))
      expect(parseLeadQuery(query).filters.perPage).toBe(perPage)
    }
  })

  it('falls back to 10 for a size the control does not offer', () => {
    for (const per of ['7', '100000', 'ALL', '', '-1']) {
      expect(parseLeadQuery({ per }).filters.perPage).toBe(10)
    }
  })
})
