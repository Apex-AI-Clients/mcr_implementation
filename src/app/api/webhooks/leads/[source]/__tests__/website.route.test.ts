// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/leads/ingestStore', () => ({
  storeIngestedLead: vi.fn(async () => ({ outcome: 'created', leadId: 'ld_1' })),
  logIntake: vi.fn(async () => {}),
}))

import { storeIngestedLead } from '@/lib/leads/ingestStore'
import { POST } from '../route'

/**
 * POST /api/webhooks/leads/website — what a website lead hands the store
 * (migration 0053): its form id, its page without the query string, its key
 * names, and a typed debt as the amount with its words. Synthetic data only.
 */

const SECRET = 'test-secret'

function post(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/webhooks/leads/website', {
    method: 'POST',
    headers: { 'x-mcr-secret': SECRET, 'x-forwarded-for': '203.0.113.7' },
    body: JSON.stringify(body),
  })
}

const params = { params: Promise.resolve({ source: 'website' }) }

const RESULTS_FORM = {
  external_id: 'ext-test-1',
  form_id: 'website_results',
  page_url: 'https://example.test/results?email=test%40example.test',
  name: 'Test Person',
  email: 'test@example.test',
  phone: '0400000001',
  debt_code: '200,000',
  state: 'NSW',
  message: 'Behind on GST.',
}

beforeEach(() => {
  vi.stubEnv('MCR_LEAD_SECRET', SECRET)
  vi.mocked(storeIngestedLead).mockClear()
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('POST /api/webhooks/leads/website (0053)', () => {
  it('stores the form id, the page without its query string, the key names and the typed debt', async () => {
    const res = await POST(post(RESULTS_FORM), params)
    expect(res.status).toBe(200)
    expect(storeIngestedLead).toHaveBeenCalledTimes(1)
    const lead = vi.mocked(storeIngestedLead).mock.calls[0][0]
    expect(lead).toMatchObject({
      source: 'website',
      metaFormId: 'website_results',
      pageUrl: 'https://example.test/results',
      debtMin: 200_000,
      debtMax: 200_000,
      debtText: '200,000',
      entityType: null,
    })
    expect(lead.metaFieldKeys).toEqual(Object.keys(RESULTS_FORM))
    // Names only: no answer is in the key list.
    expect(JSON.stringify(lead.metaFieldKeys)).not.toContain('Test Person')
  })

  it('reads a typed "3" as text on the results form, never as the $100k bracket', async () => {
    await POST(post({ ...RESULTS_FORM, debt_code: '3' }), params)
    const lead = vi.mocked(storeIngestedLead).mock.calls[0][0]
    expect(lead).toMatchObject({ debtMin: null, debtMax: null, debtText: '3' })
  })

  it('still reads a form with no form id, typed or picked', async () => {
    const { form_id: _f, page_url: _p, ...noIds } = RESULTS_FORM
    void _f
    void _p
    await POST(post(noIds), params)
    await POST(post({ ...noIds, external_id: 'ext-test-2', debt_code: '3', biz_type: 'Company' }), params)
    const [typed, picked] = vi.mocked(storeIngestedLead).mock.calls.map((c) => c[0])
    expect(typed).toMatchObject({ metaFormId: null, pageUrl: null, debtMin: 200_000, debtText: '200,000' })
    expect(picked).toMatchObject({ debtMin: 100_000, debtMax: 124_999, debtText: null, entityType: 'company' })
  })
})
