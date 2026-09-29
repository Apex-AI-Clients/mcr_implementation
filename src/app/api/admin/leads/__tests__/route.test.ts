// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase/server', () => ({ getSupabaseServerClient: vi.fn() }))
vi.mock('@/lib/auth/staff', () => ({ requireStaffUser: vi.fn() }))

import { getSupabaseServerClient } from '@/lib/supabase/server'
import { requireStaffUser } from '@/lib/auth/staff'
import { POST } from '../route'

/**
 * POST /api/admin/leads — the one-lead-per-email rule from migration 0020, as
 * the Add lead dialog meets it. Synthetic data only.
 */

const BODY = {
  lead: {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Test Person',
    email: 'Known@Example.test',
    phone: '0400000001',
    debtMin: 100_000,
    debtMax: 124_999,
    state: 'QLD',
    entityType: null,
    message: null,
    preferredCallTime: null,
    source: 'manual',
    company: null,
  },
  activity: null,
}

function request(body: unknown) {
  return new NextRequest('http://localhost/api/admin/leads', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

type Result = { data?: unknown; error: { code?: string; message: string } | null }

/** leads.insert() resolves to `insert`; the follow-up lookup to `existing`. */
function mockLeads(insert: Result, existing: Result = { data: null, error: null }) {
  const eq = vi.fn(() => ({ maybeSingle: () => Promise.resolve(existing) }))
  const chain = {
    insert: vi.fn(() => Promise.resolve(insert)),
    select: vi.fn(() => ({ eq })),
  }
  vi.mocked(getSupabaseServerClient).mockReturnValue({ from: () => chain } as never)
  return { chain, eq }
}

beforeEach(() => {
  vi.mocked(requireStaffUser).mockResolvedValue({ id: 'staff-1' } as never)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('POST /api/admin/leads', () => {
  it('creates the lead with a normalised email', async () => {
    const { chain } = mockLeads({ error: null })
    const response = await POST(request(BODY))
    expect(response.status).toBe(201)
    expect(chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'known@example.test', source: 'manual' }),
    )
  })

  it('answers 409 with the existing lead when the email already has one', async () => {
    const { eq } = mockLeads(
      {
        error: {
          code: '23505',
          message: 'duplicate key value violates unique constraint "leads_email_lower_key"',
        },
      },
      { data: { id: 'ld_existing' }, error: null },
    )
    const response = await POST(request(BODY))
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: 'A lead with this email already exists.',
      leadId: 'ld_existing',
    })
    expect(eq).toHaveBeenCalledWith('email', 'known@example.test')
  })

  it('does not treat any other unique violation as a duplicate email', async () => {
    // A reused client-generated id collides on the primary key, not the email.
    mockLeads({
      error: { code: '23505', message: 'duplicate key value violates unique constraint "leads_pkey"' },
    })
    const response = await POST(request(BODY))
    expect(response.status).toBe(500)
  })

  it('refuses a caller who is not staff', async () => {
    vi.mocked(requireStaffUser).mockResolvedValue(null as never)
    mockLeads({ error: null })
    const response = await POST(request(BODY))
    expect(response.status).toBe(401)
  })
})
