// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * POST /financials-comparison/start — one active job per client. Synthetic ids.
 *
 * The database refuses a second active job (migration 0027's unique index);
 * when two starts race, the loser gets 23505 and must hand back the job that
 * is already running, never start a second extraction.
 */

vi.mock('@/lib/supabase/server', () => ({
  getSupabaseServerClient: vi.fn(),
  getSupabaseAuthClient: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'staff-1', app_metadata: {} } }, error: null }) },
  })),
}))
vi.mock('@/lib/financials/comparisonJob', () => ({ runComparisonJob: vi.fn() }))
const afterSpy = vi.fn()
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: (fn: () => unknown) => afterSpy(fn),
}))

import { getSupabaseServerClient } from '@/lib/supabase/server'
import { POST } from '../route'

const PARAMS = { params: Promise.resolve({ id: 'client-1' }) }
const request = () =>
  new NextRequest('http://localhost/api/admin/clients/client-1/financials-comparison/start', {
    method: 'POST',
    body: JSON.stringify({ mode: 'full' }),
  })

/**
 * A fake jobs table: `activeAtCheck` is what the route's own check sees;
 * `insertError` is what the insert returns; `runningAfter` is the active job
 * the route finds when it looks again.
 */
function mockDb({
  activeAtCheck,
  insertError,
  runningAfter,
}: {
  activeAtCheck: { id: string; updated_at: string } | null
  insertError: { code: string; message: string } | null
  runningAfter: { id: string } | null
}) {
  let activeReads = 0
  const insert = vi.fn(() => ({
    select: () => ({
      single: async () => (insertError ? { data: null, error: insertError } : { data: { id: 'job-new' }, error: null }),
    }),
  }))
  const activeQuery = () => {
    const chain = {
      eq: () => chain,
      in: () => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle: async () => {
        activeReads++
        return { data: activeReads === 1 ? activeAtCheck : runningAfter, error: null }
      },
    }
    return chain
  }
  const from = vi.fn((table: string) => {
    if (table === 'clients') {
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'client-1' } }) }) }) }
    }
    return { select: activeQuery, insert, update: () => ({ eq: async () => ({ error: null }) }) }
  })
  vi.mocked(getSupabaseServerClient).mockReturnValue({ from } as never)
  return { insert }
}

beforeEach(() => {
  afterSpy.mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('one active comparison job per client', () => {
  it('starts a job when none is running', async () => {
    mockDb({ activeAtCheck: null, insertError: null, runningAfter: null })
    const res = await POST(request(), PARAMS)
    expect(await res.json()).toEqual({ jobId: 'job-new', reused: false })
    expect(afterSpy).toHaveBeenCalledTimes(1)
  })

  it('returns the running job when one is already active', async () => {
    const { insert } = mockDb({
      activeAtCheck: { id: 'job-running', updated_at: new Date().toISOString() },
      insertError: null,
      runningAfter: null,
    })
    const res = await POST(request(), PARAMS)
    expect(await res.json()).toEqual({ jobId: 'job-running', reused: true })
    expect(insert).not.toHaveBeenCalled()
    expect(afterSpy).not.toHaveBeenCalled()
  })

  it('returns the winning job, and starts nothing, when a racing start got there first', async () => {
    mockDb({
      activeAtCheck: null,
      insertError: { code: '23505', message: 'duplicate key value violates unique constraint' },
      runningAfter: { id: 'job-winner' },
    })
    const res = await POST(request(), PARAMS)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ jobId: 'job-winner', reused: true })
    expect(afterSpy).not.toHaveBeenCalled()
  })
})
