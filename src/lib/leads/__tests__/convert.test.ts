import { describe, it, expect, vi, afterEach } from 'vitest'
import { createClientFromLead } from '../convert'
import type { Lead } from '@/types/leads'

const LEAD: Lead = {
  id: 'ld_1',
  name: 'Dean Whitlock',
  email: 'dean@whitlockcivil.com.au',
  phone: '0407552118',
  debtMin: 100_000,
  debtMax: 124_999,
  entityType: 'company',
  message: null,
  preferredCallTime: null,
  state: 'QLD',
  stage: 'prospect',
  source: 'google_form',
  company: null,
  nextStep: null,
  stageSince: '2026-08-01T00:00:00.000Z',
  lastActionAt: '2026-08-01T00:00:00.000Z',
  convertedClientId: null,
  metaFormId: null,
  metaAdId: null,
  metaAdgroupId: null,
  metaPageId: null,
  metaCampaignId: null,
  metaCampaignName: null,
  metaAdName: null,
  metaAccountId: null,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
}

function mockFetch(status: number, body: unknown) {
  const fetchMock = vi.fn(async () =>
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => vi.unstubAllGlobals())

describe('createClientFromLead', () => {
  it('posts only name and email', async () => {
    const fetchMock = mockFetch(201, { id: 'client-1', name: LEAD.name })
    await createClientFromLead(LEAD)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/admin/clients')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({
      name: 'Dean Whitlock',
      email: 'dean@whitlockcivil.com.au',
    })
  })

  it('returns the new client id on 201', async () => {
    mockFetch(201, { id: 'client-1' })
    expect(await createClientFromLead(LEAD)).toEqual({ kind: 'created', clientId: 'client-1' })
  })

  it('reports a 409 as a duplicate carrying the existing file id', async () => {
    mockFetch(409, { error: 'A client with this email already exists', clientId: 'client-9' })
    expect(await createClientFromLead(LEAD)).toEqual({ kind: 'duplicate', clientId: 'client-9' })
  })

  it('falls back to a plain failure when a 409 carries no client id', async () => {
    mockFetch(409, { error: 'A client with this email already exists' })
    const result = await createClientFromLead(LEAD)
    expect(result.kind).toBe('failed')
  })

  it('surfaces the route error message on other failures', async () => {
    mockFetch(400, { error: 'Invalid email' })
    expect(await createClientFromLead(LEAD)).toEqual({ kind: 'failed', message: 'Invalid email' })
  })

  it('handles a 401 without a body', async () => {
    mockFetch(401, undefined)
    const result = await createClientFromLead(LEAD)
    expect(result.kind).toBe('failed')
  })

  it('treats a 201 with no id as a failure rather than converting to undefined', async () => {
    mockFetch(201, { name: 'Dean Whitlock' })
    const result = await createClientFromLead(LEAD)
    expect(result.kind).toBe('failed')
  })

  it('reports a network error without claiming anything was created', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )
    const result = await createClientFromLead(LEAD)
    expect(result.kind).toBe('failed')
    expect(result).toMatchObject({ message: expect.stringContaining('No client file was created') })
  })
})
