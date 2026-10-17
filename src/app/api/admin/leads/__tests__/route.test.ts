// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase/server', () => ({ getSupabaseServerClient: vi.fn() }))
vi.mock('@/lib/auth/staff', () => ({
  requireStaffUser: vi.fn(),
  staffAuthorName: () => 'Sam',
}))

import { getSupabaseServerClient } from '@/lib/supabase/server'
import { requireStaffUser } from '@/lib/auth/staff'
import { POST } from '../route'

/**
 * POST /api/admin/leads — the one-lead-per-email rule from migration 0020, as
 * the Add lead dialog meets it: a known email is merged onto the existing lead
 * as a new enquiry, never refused. Synthetic data only.
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

/** leads.insert() resolves to `insert`; ingest_lead_submission to `rpc`. */
function mockLeads(insert: Result, rpc: Result = { data: null, error: null }) {
  const chain = { insert: vi.fn(() => Promise.resolve(insert)) }
  const rpcFn = vi.fn(() => Promise.resolve(rpc))
  vi.mocked(getSupabaseServerClient).mockReturnValue({ from: () => chain, rpc: rpcFn } as never)
  return { chain, rpc: rpcFn }
}

const EMAIL_TAKEN = {
  code: '23505',
  message: 'duplicate key value violates unique constraint "leads_email_lower_key"',
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

  it('merges a known email onto the existing lead instead of refusing it', async () => {
    const { rpc } = mockLeads(
      { error: EMAIL_TAKEN },
      { data: [{ outcome: 'appended', lead_id: 'ld_existing' }], error: null },
    )
    const response = await POST(request(BODY))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ id: 'ld_existing', merged: true })
    expect(rpc).toHaveBeenCalledWith(
      'ingest_lead_submission',
      expect.objectContaining({
        p_submission: expect.objectContaining({
          email: 'known@example.test',
          source: 'manual',
          external_id: null,
          debt_min: 100_000,
          state: 'QLD',
        }),
        p_note_author: 'Sam',
        p_latest_touch: false,
      }),
    )
  })

  it('puts the opening note on the existing lead when it merges', async () => {
    const { chain } = mockLeads(
      { error: EMAIL_TAKEN },
      { data: [{ outcome: 'appended', lead_id: 'ld_existing' }], error: null },
    )
    const activity = {
      id: '22222222-2222-4222-8222-222222222222',
      type: 'note',
      body: 'Called back',
      author: 'Sam',
      createdAt: '2026-10-16T00:00:00.000Z',
    }
    await POST(request({ ...BODY, activity }))
    expect(chain.insert).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: activity.id, lead_id: 'ld_existing' }),
    )
  })

  it('answers 500 when the merge fails', async () => {
    mockLeads({ error: EMAIL_TAKEN }, { data: null, error: { message: 'boom' } })
    const response = await POST(request(BODY))
    expect(response.status).toBe(500)
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
