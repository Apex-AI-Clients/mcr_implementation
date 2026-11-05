// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase/server', () => ({ getSupabaseServerClient: vi.fn(), getSupabaseAuthClient: vi.fn() }))
vi.mock('@/lib/auth/staff', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/staff')>()),
  requireStaffUser: vi.fn(),
}))

import { getSupabaseServerClient } from '@/lib/supabase/server'
import { requireStaffUser } from '@/lib/auth/staff'
import { POST as removeFromCvl } from '../[caseId]/remove/route'
import { POST as moveToSbr } from '../[caseId]/to-sbr/route'

/**
 * A client in SBR and CVL at once (migration 0047): Delete in CVL takes it off
 * the CVL list only; Move to SBR puts a CVL file on the SBR list too.
 * Synthetic data.
 */

const PARAMS = { params: Promise.resolve({ caseId: 'case-1' }) }
const post = (url: string) => new NextRequest(url, { method: 'POST' })

function mockDb({ workflow, archivedAt = null, removedAt = null }: { workflow: 'sbr' | 'cvl'; archivedAt?: string | null; removedAt?: string | null }) {
  const caseUpdate = vi.fn<(row: Record<string, unknown>) => unknown>(() => ({ eq: () => Promise.resolve({ error: null }) }))
  const clientUpdate = vi.fn<(row: Record<string, unknown>) => unknown>(() => {
    const done = Promise.resolve({ error: null })
    return { eq: () => Object.assign(done, { is: () => done }) }
  })
  const caseRow = {
    id: 'case-1',
    client_id: 'cl_1',
    status: 'draft',
    forms_prepared_at: null,
    printed_at: null,
    removed_at: removedAt,
    clients: { name: 'Sample Trading', archived_at: archivedAt, workflow },
  }
  vi.mocked(getSupabaseServerClient).mockReturnValue({
    from: (t: string) => {
      if (t === 'cvl_cases') return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: caseRow }) }) }), update: caseUpdate }
      if (t === 'clients') return { update: clientUpdate }
      throw new Error(`unexpected table ${t}`)
    },
  } as never)
  return { caseUpdate, clientUpdate }
}

beforeEach(() => {
  vi.mocked(requireStaffUser).mockResolvedValue({ email: 'casey@example.test', user_metadata: { full_name: 'Casey' } } as never)
})

describe('Delete in CVL (remove)', () => {
  it('takes a client also in SBR off the CVL list only: its SBR side is untouched', async () => {
    const { caseUpdate, clientUpdate } = mockDb({ workflow: 'sbr' })
    const res = await removeFromCvl(post('http://localhost/api/admin/cvl/case-1/remove'), PARAMS)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, inSbr: true })
    expect(caseUpdate).toHaveBeenCalledWith(expect.objectContaining({ removed_at: expect.any(String), removed_by: expect.any(String) }))
    expect(clientUpdate).not.toHaveBeenCalled()
  })

  it('archives a CVL-only file as well, as before', async () => {
    const { caseUpdate, clientUpdate } = mockDb({ workflow: 'cvl' })
    expect((await removeFromCvl(post('http://localhost/api/admin/cvl/case-1/remove'), PARAMS)).status).toBe(200)
    expect(caseUpdate).toHaveBeenCalled()
    expect(clientUpdate).toHaveBeenCalledWith(expect.objectContaining({ archived_at: expect.any(String), archived_reason: 'client_deleted' }))
  })

  it('changes nothing for a file already off the CVL list', async () => {
    const { caseUpdate, clientUpdate } = mockDb({ workflow: 'sbr', removedAt: '2026-11-01T00:00:00Z' })
    expect((await removeFromCvl(post('http://localhost/api/admin/cvl/case-1/remove'), PARAMS)).status).toBe(200)
    expect(caseUpdate).not.toHaveBeenCalled()
    expect(clientUpdate).not.toHaveBeenCalled()
  })
})

describe('Move to SBR', () => {
  it('makes a CVL-only file an SBR client, and leaves its CVL case open', async () => {
    const { caseUpdate, clientUpdate } = mockDb({ workflow: 'cvl' })
    const res = await moveToSbr(post('http://localhost/api/admin/cvl/case-1/to-sbr'), PARAMS)
    expect(res.status).toBe(200)
    expect((await res.json()).href).toBe('/clients/cl_1')
    expect(clientUpdate).toHaveBeenCalledWith(expect.objectContaining({ workflow: 'sbr', archived_at: null }))
    expect(caseUpdate).not.toHaveBeenCalled()
  })

  it('puts an SBR client archived from SBR back on the SBR list', async () => {
    const { clientUpdate } = mockDb({ workflow: 'sbr', archivedAt: '2026-10-01T00:00:00Z' })
    expect((await moveToSbr(post('http://localhost/api/admin/cvl/case-1/to-sbr'), PARAMS)).status).toBe(200)
    expect(clientUpdate).toHaveBeenCalledWith(expect.objectContaining({ workflow: 'sbr', archived_at: null, archived_by: null, archived_reason: null }))
  })

  it('refuses a client already in SBR, or a file not in CVL', async () => {
    const inBoth = mockDb({ workflow: 'sbr' })
    expect((await moveToSbr(post('http://localhost/api/admin/cvl/case-1/to-sbr'), PARAMS)).status).toBe(409)
    expect(inBoth.clientUpdate).not.toHaveBeenCalled()
    const removed = mockDb({ workflow: 'cvl', removedAt: '2026-11-01T00:00:00Z' })
    expect((await moveToSbr(post('http://localhost/api/admin/cvl/case-1/to-sbr'), PARAMS)).status).toBe(409)
    expect(removed.clientUpdate).not.toHaveBeenCalled()
  })

  it('needs a signed-in staff member', async () => {
    vi.mocked(requireStaffUser).mockResolvedValue(null as never)
    mockDb({ workflow: 'cvl' })
    expect((await moveToSbr(post('http://localhost/api/admin/cvl/case-1/to-sbr'), PARAMS)).status).toBe(401)
    expect((await removeFromCvl(post('http://localhost/api/admin/cvl/case-1/remove'), PARAMS)).status).toBe(401)
  })
})
