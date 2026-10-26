// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ getSupabaseServerClient: vi.fn() }))
vi.mock('@/lib/auth/staff', () => ({ requireStaffUser: vi.fn(), staffAuthorName: () => 'Staff Member' }))

import { getSupabaseServerClient } from '@/lib/supabase/server'
import { requireStaffUser } from '@/lib/auth/staff'
import { POST } from '../route'

/** Marking an ATO account analysis as reviewed. Synthetic ids. */

const params = { params: Promise.resolve({ id: 'c1', analysisId: 'an-1' }) }
let update: ReturnType<typeof vi.fn>
let eqs: [string, string][]

beforeEach(() => {
  eqs = []
  const chain = {
    eq: (column: string, value: string) => {
      eqs.push([column, value])
      return chain
    },
    select: () => chain,
    maybeSingle: async () => ({ data: { id: 'an-1', reviewed_by: 'Staff Member', reviewed_at: '2026-10-26T00:00:00Z' }, error: null }),
  }
  update = vi.fn(() => chain)
  vi.mocked(getSupabaseServerClient).mockReturnValue({ from: () => ({ update }) } as never)
  vi.mocked(requireStaffUser).mockResolvedValue({ id: 'staff-1' } as never)
})

describe('POST review', () => {
  it('records who reviewed it and when, for this client only', async () => {
    const res = await POST(new Request('http://localhost'), params)
    expect(res.status).toBe(200)
    expect(update.mock.calls[0][0]).toMatchObject({ reviewed_by: 'Staff Member' })
    expect(eqs).toEqual([
      ['id', 'an-1'],
      ['client_id', 'c1'],
    ])
  })

  it('refuses anyone but staff', async () => {
    vi.mocked(requireStaffUser).mockResolvedValue(null as never)
    expect((await POST(new Request('http://localhost'), params)).status).toBe(401)
  })
})
