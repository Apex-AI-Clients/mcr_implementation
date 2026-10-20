// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase/server', () => ({ getSupabaseServerClient: vi.fn() }))
vi.mock('@/lib/auth/staff', () => ({ requireStaffUser: vi.fn(), staffAuthorName: () => 'Sam' }))

import { getSupabaseServerClient } from '@/lib/supabase/server'
import { requireStaffUser } from '@/lib/auth/staff'
import { POST } from '../route'

/** Setting a financial statement file's year and type by hand. Synthetic ids. */

const PARAMS = { params: Promise.resolve({ id: 'client-1', documentId: 'doc-1' }) }
const request = (body: unknown) =>
  new NextRequest('http://localhost/api/x', { method: 'POST', body: JSON.stringify(body) })

function mockDb(found = true) {
  const docUpdate = vi.fn()
  const staleUpdate = vi.fn()
  const docChain: Record<string, unknown> = {}
  for (const m of ['eq', 'in', 'select']) docChain[m] = () => docChain
  docChain.maybeSingle = async () => ({ data: found ? { id: 'doc-1' } : null, error: null })
  const staleChain: Record<string, unknown> = {}
  staleChain.eq = () => staleChain
  staleChain.is = async () => ({ error: null })
  vi.mocked(getSupabaseServerClient).mockReturnValue({
    from: (table: string) =>
      table === 'documents'
        ? { update: (v: unknown) => (docUpdate(v), docChain) }
        : { update: (v: unknown) => (staleUpdate(v), staleChain) },
  } as never)
  return { docUpdate, staleUpdate }
}

beforeEach(() => {
  vi.mocked(requireStaffUser).mockResolvedValue({ id: 'staff-1' } as never)
})

describe('POST financial-statements/[documentId]/period', () => {
  it('saves the year and type with who set it, and marks the comparison stale', async () => {
    const { docUpdate, staleUpdate } = mockDb()
    const response = await POST(request({ kind: 'annual', financialYear: 2025 }), PARAMS)
    expect(response.status).toBe(200)
    expect(docUpdate.mock.calls[0][0]).toMatchObject({
      fs_override_kind: 'annual',
      fs_override_fy: 2025,
      fs_override_by: 'Sam',
    })
    expect(staleUpdate).toHaveBeenCalled()
  })

  it('clears it, going back to the headings', async () => {
    const { docUpdate } = mockDb()
    await POST(request({ clear: true }), PARAMS)
    expect(docUpdate.mock.calls[0][0]).toEqual({
      fs_override_kind: null,
      fs_override_fy: null,
      fs_override_by: null,
      fs_override_at: null,
    })
  })

  it.each([[{ kind: 'quarterly', financialYear: 2025 }], [{ kind: 'annual', financialYear: 1999 }], [{}]])(
    'refuses %o',
    async (body) => {
      const { docUpdate } = mockDb()
      expect((await POST(request(body), PARAMS)).status).toBe(400)
      expect(docUpdate).not.toHaveBeenCalled()
    },
  )

  it("answers 404 for a file that is not this client's financial statement", async () => {
    mockDb(false)
    expect((await POST(request({ kind: 'annual', financialYear: 2025 }), PARAMS)).status).toBe(404)
  })

  it('refuses a caller who is not staff', async () => {
    vi.mocked(requireStaffUser).mockResolvedValue(null as never)
    mockDb()
    expect((await POST(request({ kind: 'annual', financialYear: 2025 }), PARAMS)).status).toBe(401)
  })
})
