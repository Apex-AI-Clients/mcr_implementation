// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase/server', () => ({ getSupabaseServerClient: vi.fn() }))
vi.mock('@/lib/auth/staff', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/staff')>()),
  requireStaffUser: vi.fn(),
}))

import { getSupabaseServerClient } from '@/lib/supabase/server'
import { requireStaffUser } from '@/lib/auth/staff'
import { PATCH } from '../route'

/**
 * PATCH /api/admin/leads/[id] — dismissing the "enquired again" marker, and
 * correcting the source. Synthetic data only.
 */

const PARAMS = { params: Promise.resolve({ id: 'ld_1' }) }

function request(body: unknown) {
  return new NextRequest('http://localhost/api/admin/leads/ld_1', {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

function mockDb(updateError: { code: string; message: string } | null = null) {
  const updateEq = vi.fn(() => Promise.resolve({ error: updateError }))
  const update = vi.fn(() => ({ eq: updateEq }))
  const insert = vi.fn(() => Promise.resolve({ error: null }))
  const from = vi.fn((table: string) =>
    table === 'leads'
      ? {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: { id: 'ld_1', stage: 'non_proceeding', debt_min: null, debt_max: null },
                  error: null,
                }),
            }),
          }),
          update,
        }
      : { insert },
  )
  vi.mocked(getSupabaseServerClient).mockReturnValue({ from } as never)
  return { from, update, insert }
}

beforeEach(() => {
  vi.mocked(requireStaffUser).mockResolvedValue({
    id: 'staff-1',
    email: 'test.staff@example.test',
    user_metadata: { full_name: 'Test Staff' },
  } as never)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('PATCH /api/admin/leads/[id] — dismiss', () => {
  it('records who and when from the session, and writes no activity', async () => {
    const { update, insert, from } = mockDb()
    const response = await send({ patch: { dismissReenquiry: true } })

    expect(response.status).toBe(200)
    const written = (update.mock.calls[0] as unknown as [Record<string, unknown>])[0]
    expect(written.reenquiry_dismissed_by).toBe('Test')
    expect(typeof written.reenquiry_dismissed_at).toBe('string')
    // Only the dismissal: the stage (and so the marker's own timestamp) is untouched.
    expect(Object.keys(written).sort()).toEqual(['reenquiry_dismissed_at', 'reenquiry_dismissed_by'])
    // Not a logged action, so the follow-up clock's trigger never fires.
    expect(insert).not.toHaveBeenCalled()
    expect(from).not.toHaveBeenCalledWith('lead_activities')
  })

  it('ignores a name sent in the body — the session decides who dismissed it', async () => {
    const { update } = mockDb()
    await send({ patch: { dismissReenquiry: true, reenquiryDismissedBy: 'Someone Else' } })
    const written = (update.mock.calls[0] as unknown as [Record<string, unknown>])[0]
    expect(written.reenquiry_dismissed_by).toBe('Test')
  })

  it('rejects anything but true', async () => {
    mockDb()
    const response = await send({ patch: { dismissReenquiry: false } })
    expect(response.status).toBe(400)
  })
})

function send(body: unknown) {
  return PATCH(request(body), PARAMS)
}

describe('PATCH /api/admin/leads/[id] — source', () => {
  it('saves a corrected source, and writes no activity', async () => {
    const { update, insert } = mockDb()
    const response = await PATCH(request({ patch: { source: 'website' } }), PARAMS)

    expect(response.status).toBe(200)
    expect(update).toHaveBeenCalledWith({ source: 'website' })
    expect(insert).not.toHaveBeenCalled()
  })

  it('rejects a source that is not one of the four', async () => {
    const { update } = mockDb()
    const response = await PATCH(request({ patch: { source: 'tiktok' } }), PARAMS)

    expect(response.status).toBe(400)
    expect(update).not.toHaveBeenCalled()
  })

  it('answers 409, not 500, when the new source collides with another delivery', async () => {
    mockDb({ code: '23505', message: 'duplicate key value violates unique constraint' })
    const response = await PATCH(request({ patch: { source: 'website' } }), PARAMS)

    expect(response.status).toBe(409)
    expect((await response.json()).error).toMatch(/Another lead already has that source/)
  })
})
