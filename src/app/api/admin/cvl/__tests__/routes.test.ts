// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase/server', () => ({
  getSupabaseServerClient: vi.fn(),
  getSupabaseAuthClient: vi.fn(),
}))
vi.mock('@/lib/auth/staff', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/staff')>()),
  requireStaffUser: vi.fn(),
}))

import { getSupabaseServerClient } from '@/lib/supabase/server'
import { requireStaffUser } from '@/lib/auth/staff'
import { POST as convert } from '../convert/route'
import { PATCH as setStatus } from '../[caseId]/status/route'

/** Convert to CVL and the CVL status. Synthetic ids and names only. */

const CLIENT_ID = '11111111-1111-4111-8111-111111111111'

function post(body: unknown) {
  return new NextRequest('http://localhost/api/admin/cvl/convert', { method: 'POST', body: JSON.stringify(body) })
}
function patch(body: unknown) {
  return new NextRequest('http://localhost/api/admin/cvl/case-1/status', { method: 'PATCH', body: JSON.stringify(body) })
}
const PARAMS = { params: Promise.resolve({ caseId: 'case-1' }) }

beforeEach(() => {
  vi.mocked(requireStaffUser).mockResolvedValue({
    id: 'staff-1',
    email: 'casey@example.com',
    user_metadata: { full_name: 'Casey Staff' },
  } as never)
})

describe('POST /api/admin/cvl/convert', () => {
  function mockRpc(result: { data: unknown; error: { code: string; message: string } | null }) {
    const rpc = vi.fn(() => Promise.resolve(result))
    vi.mocked(getSupabaseServerClient).mockReturnValue({ rpc } as never)
    return rpc
  }

  it('needs a session', async () => {
    vi.mocked(requireStaffUser).mockResolvedValue(null)
    expect((await convert(post({ clientId: CLIENT_ID }))).status).toBe(401)
  })

  it('needs a client id', async () => {
    mockRpc({ data: null, error: null })
    expect((await convert(post({}))).status).toBe(400)
    expect((await convert(post({ clientId: 'not-a-uuid' }))).status).toBe(400)
  })

  it('moves the file in one call, recording who did it, and opens the CVL page', async () => {
    const rpc = mockRpc({ data: 'case-1', error: null })
    const res = await convert(post({ clientId: CLIENT_ID }))
    expect(res.status).toBe(201)
    expect(rpc).toHaveBeenCalledWith('cvl_convert_client', { p_client_id: CLIENT_ID, p_by: 'Casey' })
    expect(await res.json()).toEqual({ ok: true, caseId: 'case-1', href: `/cvl/${CLIENT_ID}` })
  })

  it('answers 404 for a client that is not there', async () => {
    mockRpc({ data: null, error: { code: 'P0002', message: 'client not found' } })
    expect((await convert(post({ clientId: CLIENT_ID }))).status).toBe(404)
  })

  it('answers 409 for an archived file or one already in CVL', async () => {
    mockRpc({ data: null, error: { code: '55000', message: 'client is already in CVL' } })
    const res = await convert(post({ clientId: CLIENT_ID }))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/SBR client list/)
  })
})

describe('PATCH /api/admin/cvl/[caseId]/status', () => {
  const ROW = {
    id: 'case-1',
    client_id: CLIENT_ID,
    origin: 'lead',
    status: 'draft',
    forms_prepared_at: null,
    printed_at: null,
    sbr_archived_at: null,
    sbr_archived_by: null,
    created_by: 'Casey',
    created_at: '2026-10-28T00:00:00.000Z',
  }

  function mockCases(row: Record<string, unknown> | null) {
    const update = vi.fn((changes: Record<string, unknown>) => ({
      eq: () => ({ select: () => ({ single: () => Promise.resolve({ data: { ...row, ...changes }, error: null }) }) }),
    }))
    vi.mocked(getSupabaseServerClient).mockReturnValue({
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: row, error: null }) }) }),
        update,
      }),
    } as never)
    return update
  }

  it('refuses a status that does not exist', async () => {
    mockCases(ROW)
    expect((await setStatus(patch({ status: 'done' }), PARAMS)).status).toBe(400)
  })

  it('answers 404 for a case that is not there', async () => {
    mockCases(null)
    expect((await setStatus(patch({ status: 'printed' }), PARAMS)).status).toBe(404)
  })

  it('stamps the step it moves to', async () => {
    const update = mockCases(ROW)
    const res = await setStatus(patch({ status: 'forms_prepared' }), PARAMS)
    expect(res.status).toBe(200)
    const changes = update.mock.calls[0][0]
    expect(changes).toMatchObject({ status: 'forms_prepared', printed_at: null })
    expect(typeof changes.forms_prepared_at).toBe('string')
    expect((await res.json()).case.status).toBe('forms_prepared')
  })

  it('writes nothing when the status is already the one asked for', async () => {
    const update = mockCases(ROW)
    const res = await setStatus(patch({ status: 'draft' }), PARAMS)
    expect(res.status).toBe(200)
    expect(update).not.toHaveBeenCalled()
  })
})
