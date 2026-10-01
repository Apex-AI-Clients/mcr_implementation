// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase/server', () => ({
  getSupabaseServerClient: vi.fn(),
  getSupabaseAuthClient: vi.fn(),
}))

import { getSupabaseAuthClient, getSupabaseServerClient } from '@/lib/supabase/server'
import { POST } from '../route'

/**
 * POST /api/admin/clients — lead conversion writes the client and its company
 * details in one request, now including what came off the ASIC extract.
 * Synthetic people only.
 */

const JANE = { name: 'Jane Sample', dateOfBirth: '1970-03-14' }
const LEAD_ID = '11111111-1111-4111-8111-111111111111'

const BODY = {
  name: 'Dean Whitlock',
  email: 'Dean@Example.test',
  phone: '0400 000 001',
  companyDetails: {
    companyName: 'Sample Trading Pty Ltd',
    acnNumber: '123456780',
    abnNumber: '11123456780',
    trustName: '',
    phoneNumber: '',
    emailAddress: '',
    registeredOfficeAddress: '1 Sample Road',
    principalPlaceOfBusiness: '2 Sample Road',
    directors: [JANE, { name: 'Raj Example', dateOfBirth: null }],
    asicExtractDate: '2026-09-23T14:07:38+10:00',
    companyDetailsSource: 'asic_pdf',
  },
}

function post(body: unknown) {
  return new NextRequest('http://localhost/api/admin/clients', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

type DbError = { message: string } | null

function mockDb({
  detailsError = null as DbError,
  lead = { id: LEAD_ID, stage: 'prospect' } as { id: string; stage: string } | null,
  leadUpdateError = null as DbError,
  activityError = null as DbError,
} = {}) {
  const clientInsert = vi.fn<(row: Record<string, unknown>) => unknown>(() => ({
    select: () => ({ single: () => Promise.resolve({ data: { id: 'cl_1' }, error: null }) }),
  }))
  const clientDelete = vi.fn(() => ({ eq: () => Promise.resolve({ error: null }) }))
  const detailsInsert = vi.fn<(row: Record<string, unknown>) => unknown>(() =>
    Promise.resolve({ error: detailsError }),
  )
  const leadUpdate = vi.fn<(row: Record<string, unknown>) => unknown>(() => ({
    eq: () => Promise.resolve({ error: leadUpdateError }),
  }))
  const activityInsert = vi.fn<(row: Record<string, unknown>) => unknown>(() =>
    Promise.resolve({ error: activityError }),
  )
  const tables: Record<string, unknown> = {
    clients: {
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }),
      insert: clientInsert,
      delete: clientDelete,
    },
    company_details: { insert: detailsInsert },
    leads: {
      select: () => ({
        eq: () => ({ maybeSingle: () => Promise.resolve({ data: lead, error: null }) }),
      }),
      update: leadUpdate,
    },
    lead_activities: { insert: activityInsert },
  }
  vi.mocked(getSupabaseServerClient).mockReturnValue({
    from: (table: string) => tables[table],
  } as never)
  return { clientInsert, clientDelete, detailsInsert, leadUpdate, activityInsert }
}

function signedIn(user: { id: string; email?: string } | null) {
  vi.mocked(getSupabaseAuthClient).mockResolvedValue({
    auth: { getUser: () => Promise.resolve({ data: { user }, error: null }) },
  } as never)
}

beforeEach(() => {
  signedIn({ id: 'staff-1', email: 'gabby@example.test' })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('POST /api/admin/clients — company details from conversion', () => {
  it('writes the ASIC fields in the same request as the client', async () => {
    const { detailsInsert } = mockDb()

    const response = await POST(post(BODY))

    expect(response.status).toBe(201)
    expect(detailsInsert).toHaveBeenCalledWith({
      client_id: 'cl_1',
      // Not sent by this body, so a new row is a company (migration 0023).
      entity_type: 'company',
      company_name: 'Sample Trading Pty Ltd',
      acn_number: '123456780',
      abn_number: '11123456780',
      trust_name: '',
      trust_abn_number: null,
      phone_number: '',
      email_address: '',
      registered_office_address: '1 Sample Road',
      principal_place_of_business: '2 Sample Road',
      directors: [JANE, { name: 'Raj Example', dateOfBirth: null }],
      asic_extract_date: '2026-09-23T14:07:38+10:00',
      company_details_source: 'asic_pdf',
    })
  })

  it("keeps the lead's name as the client's name, whoever the directors are", async () => {
    const { clientInsert } = mockDb()
    await POST(post(BODY))
    expect(clientInsert).toHaveBeenCalledWith(expect.objectContaining({ name: 'Dean Whitlock' }))
  })

  it('still converts with none of the new fields', async () => {
    const { detailsInsert } = mockDb()
    const { companyName, acnNumber, abnNumber } = BODY.companyDetails

    const response = await POST(
      post({ ...BODY, companyDetails: { companyName, acnNumber, abnNumber } }),
    )

    expect(response.status).toBe(201)
    expect(detailsInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        registered_office_address: null,
        principal_place_of_business: null,
        directors: [],
        asic_extract_date: null,
        company_details_source: null,
      }),
    )
  })

  it.each([
    [
      'a date of birth in the wrong shape',
      { directors: [{ name: 'Jane Sample', dateOfBirth: '14/03/1970' }] },
    ],
    ['a source outside the three', { companyDetailsSource: 'made_up' }],
  ])('400 for %s, creating nothing', async (_, fields) => {
    const { clientInsert, detailsInsert } = mockDb()
    const response = await POST(
      post({ ...BODY, companyDetails: { ...BODY.companyDetails, ...fields } }),
    )
    expect(response.status).toBe(400)
    expect(clientInsert).not.toHaveBeenCalled()
    expect(detailsInsert).not.toHaveBeenCalled()
  })

  it('undoes the client when the details cannot be written', async () => {
    const { clientDelete } = mockDb({ detailsError: { message: 'boom' } })
    const response = await POST(post(BODY))
    expect(response.status).toBe(500)
    expect(clientDelete).toHaveBeenCalled()
  })

  it('answers 401 without a staff session', async () => {
    signedIn(null)
    const { clientInsert } = mockDb()
    expect((await POST(post(BODY))).status).toBe(401)
    expect(clientInsert).not.toHaveBeenCalled()
  })
})

describe('POST /api/admin/clients — converting a lead', () => {
  it('marks the lead converted and links it, in the same request as the file', async () => {
    const { leadUpdate, activityInsert } = mockDb()

    const response = await POST(post({ ...BODY, leadId: LEAD_ID }))

    expect(response.status).toBe(201)
    expect(leadUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ stage: 'client', converted_client_id: 'cl_1' }),
    )
    expect(leadUpdate.mock.calls[0][0]).toHaveProperty('stage_since')
    expect(activityInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        lead_id: LEAD_ID,
        type: 'stage_change',
        body: 'Converted to a client file in the restructuring workspace.',
        // From the session, not the request.
        author: 'gabby',
      }),
    )

    const body = await response.json()
    expect(body).toMatchObject({ id: 'cl_1', leadLinked: true })
    expect(body.leadActivity).toMatchObject({ leadId: LEAD_ID, type: 'stage_change' })
  })

  it('does not restart the stage clock for a lead already at client', async () => {
    const { leadUpdate } = mockDb({ lead: { id: LEAD_ID, stage: 'client' } })
    await POST(post({ ...BODY, leadId: LEAD_ID }))
    expect(leadUpdate.mock.calls[0][0]).not.toHaveProperty('stage_since')
  })

  it('creates nothing for a lead that does not exist', async () => {
    const { clientInsert } = mockDb({ lead: null })
    const response = await POST(post({ ...BODY, leadId: LEAD_ID }))
    expect(response.status).toBe(404)
    expect(clientInsert).not.toHaveBeenCalled()
  })

  it('undoes the client file when the lead cannot be updated', async () => {
    const { clientDelete, activityInsert } = mockDb({ leadUpdateError: { message: 'boom' } })

    const response = await POST(post({ ...BODY, leadId: LEAD_ID }))

    expect(response.status).toBe(500)
    expect((await response.json()).error).toBe(
      'Could not update the lead. No client file was created.',
    )
    expect(clientDelete).toHaveBeenCalled()
    expect(activityInsert).not.toHaveBeenCalled()
  })

  it('keeps the conversion when only the timeline entry fails', async () => {
    const { clientDelete } = mockDb({ activityError: { message: 'boom' } })

    const response = await POST(post({ ...BODY, leadId: LEAD_ID }))

    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({ id: 'cl_1', leadLinked: true, leadActivity: null })
    expect(clientDelete).not.toHaveBeenCalled()
  })

  it('touches no lead when the request names none — the intake wizard', async () => {
    const { leadUpdate, activityInsert } = mockDb()
    const response = await POST(post(BODY))
    expect(response.status).toBe(201)
    expect(await response.json()).not.toHaveProperty('leadLinked')
    expect(leadUpdate).not.toHaveBeenCalled()
    expect(activityInsert).not.toHaveBeenCalled()
  })

  it('rejects a lead id that is not a uuid', async () => {
    const { clientInsert } = mockDb()
    expect((await POST(post({ ...BODY, leadId: 'ld_1' }))).status).toBe(400)
    expect(clientInsert).not.toHaveBeenCalled()
  })
})
