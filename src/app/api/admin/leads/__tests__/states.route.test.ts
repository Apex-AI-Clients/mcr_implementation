// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase/server', () => ({ getSupabaseServerClient: vi.fn() }))
vi.mock('@/lib/auth/staff', () => ({ requireStaffUser: vi.fn() }))

import { getSupabaseServerClient } from '@/lib/supabase/server'
import { requireStaffUser } from '@/lib/auth/staff'
import { POST } from '../route'

/**
 * POST /api/admin/leads — one state or several, from the Add lead dialog.
 * Several are stored in the columns a form's grouped answer already uses, so
 * there is no schema change. Synthetic data only.
 */

const LEAD = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Test Person',
  email: 'test.person@example.test',
  phone: '0400000001',
  debtMin: 100_000,
  debtMax: 124_999,
  entityType: null,
  message: null,
  preferredCallTime: null,
  source: 'manual',
  company: null,
}

function request(state: string | null, stateOptions?: string[] | null) {
  return new NextRequest('http://localhost/api/admin/leads', {
    method: 'POST',
    body: JSON.stringify({
      lead: { ...LEAD, state, ...(stateOptions === undefined ? {} : { stateOptions }) },
      activity: null,
    }),
  })
}

function mockInsert() {
  const insert = vi.fn<(row: Record<string, unknown>) => unknown>(() =>
    Promise.resolve({ error: null }),
  )
  vi.mocked(getSupabaseServerClient).mockReturnValue({ from: () => ({ insert }) } as never)
  return insert
}

beforeEach(() => {
  vi.mocked(requireStaffUser).mockResolvedValue({ id: 'staff-1' } as never)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('POST /api/admin/leads — states', () => {
  it('stores one state as the state', async () => {
    const insert = mockInsert()
    expect((await POST(request('QLD'))).status).toBe(201)
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'QLD', meta_state_raw: null, meta_state_options: null }),
    )
  })

  it('stores several states as a list with its label, and no single state', async () => {
    const insert = mockInsert()
    // Sent out of order and repeated: the route puts them in one fixed order.
    expect((await POST(request(null, ['VIC', 'NSW', 'VIC']))).status).toBe(201)
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        state: null,
        meta_state_raw: 'NSW, VIC',
        meta_state_options: ['NSW', 'VIC'],
      }),
    )
  })

  it('treats a list that comes down to one state as that state', async () => {
    const insert = mockInsert()
    expect((await POST(request(null, ['WA', 'WA']))).status).toBe(201)
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'WA', meta_state_raw: null, meta_state_options: null }),
    )
  })

  it.each([
    ['no state at all', null, undefined],
    ['a state and a list together', 'QLD', ['NSW', 'VIC']],
    ['a list of one', null, ['NSW']],
    ['a state that does not exist', null, ['NSW', 'Auckland']],
  ] as const)('400 for %s, creating nothing', async (_, state, options) => {
    const insert = mockInsert()
    const response = await POST(request(state, options ? [...options] : options))
    expect(response.status).toBe(400)
    expect(insert).not.toHaveBeenCalled()
  })
})
