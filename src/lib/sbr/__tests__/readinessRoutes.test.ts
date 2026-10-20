// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase/server', () => ({
  getSupabaseServerClient: vi.fn(),
  getSupabaseAuthClient: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'staff-1', app_metadata: {} } }, error: null }) },
  })),
}))
vi.mock('@/lib/auth/staff', () => ({ requireStaffUser: vi.fn(async () => ({ id: 'staff-1' })), staffAuthorName: () => 'Sam' }))
vi.mock('@/lib/sbr/loadReadiness', () => ({ loadReadiness: vi.fn() }))
vi.mock('@/lib/analysis/autoRun', () => ({ scheduleClientAnalysis: vi.fn() }))
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: vi.fn(),
}))

import { getSupabaseServerClient } from '@/lib/supabase/server'
import { loadReadiness } from '@/lib/sbr/loadReadiness'
import { scheduleClientAnalysis } from '@/lib/analysis/autoRun'
import { POST as REVIEW } from '@/app/api/admin/clients/[id]/readiness/review/route'
import { POST as RUN } from '@/app/api/admin/clients/[id]/analysis/run/route'
import { POST as PREDICT } from '@/app/api/admin/clients/[id]/predict-outcome/route'
import type { Readiness, ReadinessItem } from '../readiness'

/** The readiness routes and the predict API's gate. Synthetic data only. */

const PARAMS = { params: Promise.resolve({ id: 'client-1' }) }
const post = (body: unknown) => new NextRequest('http://localhost/x', { method: 'POST', body: JSON.stringify(body) })

function readiness(item: Partial<ReadinessItem>, over: Partial<Readiness> = {}): Readiness {
  return {
    items: [
      {
        key: 'financials',
        label: 'Financial statements',
        status: 'needs_review',
        detail: '',
        notes: [],
        fingerprint: 'fp-now',
        review: null,
        canRunNow: false,
        href: '',
        ...item,
      },
    ],
    canPredict: false,
    waitingFor: ['Financial statements: needs review'],
    dpn: true,
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('POST readiness/review', () => {
  function mockUpsert() {
    const upsert = vi.fn(async () => ({ error: null }))
    vi.mocked(getSupabaseServerClient).mockReturnValue({ from: () => ({ upsert }) } as never)
    return upsert
  }

  it("records the review against the data as it is now, never the request's say-so", async () => {
    const upsert = mockUpsert()
    vi.mocked(loadReadiness).mockResolvedValue(readiness({}))
    const res = await REVIEW(post({ item: 'financials', fingerprint: 'forged' }), PARAMS)
    expect(res.status).toBe(200)
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ client_id: 'client-1', item: 'financials', fingerprint: 'fp-now', reviewed_by: 'Sam' }),
      { onConflict: 'client_id,item' },
    )
  })

  it('refuses when the item is not waiting for a review', async () => {
    const upsert = mockUpsert()
    vi.mocked(loadReadiness).mockResolvedValue(readiness({ status: 'ready' }))
    expect((await REVIEW(post({ item: 'financials' }), PARAMS)).status).toBe(409)
    expect(upsert).not.toHaveBeenCalled()
  })
})

describe('POST analysis/run', () => {
  function mockClient(client: { id: string; archived_at: string | null } | null) {
    const chain: Record<string, unknown> = {}
    chain.select = () => chain
    chain.eq = () => chain
    chain.maybeSingle = async () => ({ data: client })
    vi.mocked(getSupabaseServerClient).mockReturnValue({ from: () => chain } as never)
  }

  it('starts the run, or hands back the one already going', async () => {
    mockClient({ id: 'client-1', archived_at: null })
    vi.mocked(scheduleClientAnalysis).mockResolvedValue({ jobId: 'job-1', started: true })
    const res = await RUN(post({}), PARAMS)
    expect(await res.json()).toEqual({ jobId: 'job-1', started: true })
  })

  it('refuses an archived file', async () => {
    mockClient({ id: 'client-1', archived_at: '2026-10-01' })
    expect((await RUN(post({}), PARAMS)).status).toBe(409)
    expect(scheduleClientAnalysis).not.toHaveBeenCalled()
  })
})

describe('POST predict-outcome — the readiness gate', () => {
  it('answers 422 with what it is waiting for, before reading anything else', async () => {
    const from = vi.fn((table: string) => {
      const chain: Record<string, unknown> = {}
      chain.select = () => chain
      chain.eq = () => chain
      chain.maybeSingle = async () => ({ data: table === 'clients' ? { id: 'client-1', name: 'Example' } : null })
      return chain
    })
    vi.mocked(getSupabaseServerClient).mockReturnValue({ from } as never)
    vi.mocked(loadReadiness).mockResolvedValue(readiness({}))

    const res = await PREDICT(post({ dpn: false, paymentPlanType: 'plan', directorLoanAtAppointment: false }), PARAMS)
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'NOT_READY', waitingFor: ['Financial statements: needs review'] })
    expect(from.mock.calls.map(([t]) => t)).toEqual(['clients'])
  })
})
