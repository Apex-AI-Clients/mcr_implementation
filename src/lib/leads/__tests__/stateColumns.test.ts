import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { describeUncertainState, stateColumns } from '../format'
import { leadsPersistence } from '../persistence'
import type { Lead } from '@/types/leads'

/**
 * States ticked in Add lead: one, or several. Several reuse the columns a
 * form's grouped state answer already uses, so no schema change was needed and
 * the state filter finds the lead under each of them.
 */

describe('stateColumns', () => {
  it('stores one state as the state', () => {
    expect(stateColumns(['QLD'])).toEqual({
      state: 'QLD',
      metaStateRaw: null,
      metaStateOptions: null,
    })
  })

  it('stores several as a list, never alongside a state', () => {
    // The database forbids a state and a list of states together.
    expect(stateColumns(['NSW', 'VIC'])).toEqual({
      state: null,
      metaStateRaw: 'NSW, VIC',
      metaStateOptions: ['NSW', 'VIC'],
    })
  })

  it('uses one fixed order whatever order they were ticked in, without repeats', () => {
    expect(stateColumns(['TAS', 'NSW', 'TAS', 'QLD'])).toEqual({
      state: null,
      metaStateRaw: 'NSW, QLD, TAS',
      metaStateOptions: ['NSW', 'QLD', 'TAS'],
    })
    expect(stateColumns(['VIC', 'VIC']).state).toBe('VIC')
  })

  it('is empty for nothing ticked', () => {
    expect(stateColumns([])).toEqual({ state: null, metaStateRaw: null, metaStateOptions: null })
  })
})

describe('describeUncertainState — several states', () => {
  const columns = stateColumns(['NSW', 'VIC'])

  it('reads as the states staff chose, on a lead added by hand', () => {
    expect(describeUncertainState({ ...columns, source: 'manual' })).toEqual({
      label: 'NSW, VIC',
      description: 'States: NSW, VIC',
    })
  })

  it('still reads as "one of" for a form\'s grouped answer', () => {
    expect(describeUncertainState({ ...columns, source: 'facebook' })).toEqual({
      label: 'NSW, VIC',
      description: 'One of NSW, VIC',
    })
    // And when the caller does not say where the lead came from.
    expect(describeUncertainState(columns)?.description).toBe('One of NSW, VIC')
  })
})

describe('leadsPersistence.createLead — states', () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 201 }))

  beforeEach(() => {
    fetchMock.mockClear()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  const LEAD = {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Test Person',
    email: 'test.person@example.test',
    phone: '0400000001',
    debtMin: 100_000,
    debtMax: 124_999,
    entityType: null,
    message: null,
    preferredCallTime: null,
    source: 'manual',
    company: null,
  } as unknown as Lead

  function sentLead(): Record<string, unknown> {
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    return JSON.parse(init.body as string).lead
  }

  it('sends several states as a list, with no single state', async () => {
    await leadsPersistence.createLead!({
      lead: { ...LEAD, ...stateColumns(['NSW', 'VIC']) },
      activity: null,
    })
    const lead = sentLead()
    expect(lead.state).toBeNull()
    expect(lead.stateOptions).toEqual(['NSW', 'VIC'])
    // The display text is the route's to build, from the states themselves.
    expect(lead).not.toHaveProperty('metaStateRaw')
  })

  it('sends one state as the state, with no list', async () => {
    await leadsPersistence.createLead!({
      lead: { ...LEAD, ...stateColumns(['QLD']) },
      activity: null,
    })
    expect(sentLead()).toMatchObject({ state: 'QLD', stateOptions: null })
  })
})
