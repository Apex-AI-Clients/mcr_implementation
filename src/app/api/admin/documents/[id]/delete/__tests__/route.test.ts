// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase/server', () => ({
  getSupabaseServerClient: vi.fn(),
  getSupabaseAuthClient: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'staff-1' } }, error: null }) },
  })),
}))
vi.mock('@/lib/auth/staff', () => ({ requireStaffUser: vi.fn(async () => ({ id: 'staff-1' })) }))
vi.mock('@/lib/clients/status', () => ({ recomputeClientStatus: vi.fn() }))
vi.mock('@/lib/analysis/autoRun', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/analysis/autoRun')>()),
  scheduleClientAnalysis: vi.fn(async () => ({ jobId: 'job-1', started: true })),
}))
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: vi.fn(),
}))

import { getSupabaseServerClient } from '@/lib/supabase/server'
import { scheduleClientAnalysis } from '@/lib/analysis/autoRun'
import { POST as ADMIN_DELETE } from '../route'
import { POST as PORTAL_DELETE } from '@/app/api/portal/delete-document/route'

/** Deleting a document re-runs the client's analyses without it. Synthetic ids. */

function mockDb(category: string) {
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'eq']) chain[m] = () => chain
  chain.single = async () => ({ data: { id: 'doc-1', file_path: 'client-1/a', client_id: 'client-1', doc_category: category } })
  chain.delete = () => {
    const del: Record<string, unknown> = {}
    del.eq = () => del
    del.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve)
    return del
  }
  vi.mocked(getSupabaseServerClient).mockReturnValue({
    from: () => chain,
    storage: { from: () => ({ remove: async () => ({ error: null }) }) },
  } as never)
}

const adminDelete = () => ADMIN_DELETE(new NextRequest('http://localhost/x', { method: 'POST' }), { params: Promise.resolve({ id: 'doc-1' }) })
const portalDelete = () =>
  PORTAL_DELETE(new NextRequest('http://localhost/x', { method: 'POST', body: JSON.stringify({ documentId: 'doc-1', clientId: 'client-1' }) }))

beforeEach(() => vi.clearAllMocks())

describe.each([
  ['admin delete', adminDelete],
  ['portal delete', portalDelete],
])('%s', (_name, run) => {
  it('re-runs the analyses after a financial statement is deleted', async () => {
    mockDb('financial_statements')
    expect((await run()).status).toBe(200)
    expect(scheduleClientAnalysis).toHaveBeenCalledWith(expect.anything(), 'client-1', expect.any(Function))
  })

  it('leaves them alone for a trust deed', async () => {
    mockDb('trust_deed')
    await run()
    expect(scheduleClientAnalysis).not.toHaveBeenCalled()
  })
})
