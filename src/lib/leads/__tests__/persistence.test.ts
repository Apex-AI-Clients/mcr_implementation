import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { leadsPersistence } from '../persistence'
import type { Lead, LeadActivity } from '@/types/leads'

/**
 * The write contract, not the transport.
 *
 * The rule the schema depends on: `last_action_at` is owned by the trigger on
 * lead_activities, so no request may carry it, and only the calls that are
 * meant to reset the follow-up clock may carry an activity.
 */

const LEAD: Lead = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Dean Whitlock',
  email: 'dean@whitlockcivil.com.au',
  phone: '0407552118',
  debtMin: 150_000,
  debtMax: null,
  state: 'QLD',
  entityType: 'company',
  message: 'Civil contracting.',
  preferredCallTime: 'After 6pm',
  stage: 'lead',
  source: 'manual',
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
  metaStateRaw: null,
  metaStateOptions: null,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
}

const ACTIVITY: LeadActivity = {
  id: '22222222-2222-4222-8222-222222222222',
  leadId: LEAD.id,
  type: 'stage_change',
  body: 'Stage changed from Lead to Prospect.',
  author: 'Gabby',
  createdAt: '2026-09-01T00:00:00.000Z',
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

function lastCall(): { url: string; method: string; body: Record<string, unknown> } {
  const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as unknown as [
    string,
    RequestInit,
  ]
  return { url, method: init.method as string, body: JSON.parse(init.body as string) }
}

describe('leadsPersistence', () => {
  it('creates a lead with its opening activity', async () => {
    await leadsPersistence.createLead!({ lead: LEAD, activity: null })
    const { url, method, body } = lastCall()
    expect(url).toBe('/api/admin/leads')
    expect(method).toBe('POST')
    expect((body.lead as Record<string, unknown>).id).toBe(LEAD.id)
    expect((body.lead as Record<string, unknown>).debtMin).toBe(150_000)
    expect((body.lead as Record<string, unknown>).debtMax).toBeNull()
  })

  it('sends a data correction with no activity, so the clock is untouched', async () => {
    await leadsPersistence.updateLead!({
      leadId: LEAD.id,
      patch: { debtMin: 500_000, debtMax: null },
    })
    const { url, method, body } = lastCall()
    expect(url).toBe(`/api/admin/leads/${LEAD.id}`)
    expect(method).toBe('PATCH')
    expect(body.activity).toBeUndefined()
    expect(body.patch).toEqual({ debtMin: 500_000, debtMax: null })
  })

  it('sends a stage change together with its activity', async () => {
    await leadsPersistence.stageChange!({
      leadId: LEAD.id,
      stage: 'prospect',
      activity: ACTIVITY,
    })
    const { body } = lastCall()
    expect(body.patch).toEqual({ stage: 'prospect' })
    expect((body.activity as LeadActivity).id).toBe(ACTIVITY.id)
  })

  it('sends a conversion as stage plus client id plus activity', async () => {
    await leadsPersistence.conversion!({
      leadId: LEAD.id,
      clientId: '33333333-3333-4333-8333-333333333333',
      activity: ACTIVITY,
    })
    const { body } = lastCall()
    expect(body.patch).toEqual({
      stage: 'client',
      convertedClientId: '33333333-3333-4333-8333-333333333333',
    })
    expect(body.activity).toBeTruthy()
  })

  it('posts an activity to the lead it belongs to', async () => {
    await leadsPersistence.logActivity!({ activity: { ...ACTIVITY, type: 'call' } })
    const { url, method } = lastCall()
    expect(url).toBe(`/api/admin/leads/${LEAD.id}/activities`)
    expect(method).toBe('POST')
  })

  it('never sends last_action_at — the trigger owns that column', async () => {
    await leadsPersistence.createLead!({ lead: LEAD, activity: ACTIVITY })
    await leadsPersistence.updateLead!({ leadId: LEAD.id, patch: { phone: '0400000000' } })
    await leadsPersistence.stageChange!({ leadId: LEAD.id, stage: 'client', activity: ACTIVITY })
    await leadsPersistence.logActivity!({ activity: ACTIVITY })

    for (const call of fetchMock.mock.calls) {
      const body = (call as unknown as [string, RequestInit])[1].body as string
      expect(body).not.toContain('last_action_at')
      expect(body).not.toContain('lastActionAt')
    }
  })

  it('rejects on a non-2xx so the store rolls back', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Lead not found' }), { status: 404 }),
    )
    await expect(
      leadsPersistence.updateLead!({ leadId: LEAD.id, patch: { phone: '0400000000' } }),
    ).rejects.toThrow('Lead not found')
  })

  it('rejects with a plain message when the server sends no JSON', async () => {
    fetchMock.mockResolvedValueOnce(new Response('gateway timeout', { status: 504 }))
    await expect(
      leadsPersistence.logActivity!({ activity: ACTIVITY }),
    ).rejects.toThrow(/504/)
  })

  it('rejects when the network is unreachable', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(
      leadsPersistence.createLead!({ lead: LEAD, activity: null }),
    ).rejects.toThrow('Could not reach the server')
  })
})
