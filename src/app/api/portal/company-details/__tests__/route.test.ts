// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase/server', () => ({ getSupabaseServerClient: vi.fn() }))
vi.mock('@/lib/auth/staff', () => ({ requireStaffUser: vi.fn() }))

import { getSupabaseServerClient } from '@/lib/supabase/server'
import { requireStaffUser } from '@/lib/auth/staff'
import { GET, POST } from '../route'

/**
 * /api/portal/company-details — the intake route for this record.
 *
 * It used to take the request JSON as it came. It now validates it, because
 * directors is stored as jsonb, and it must still leave alone every column a
 * partial save did not mention. Synthetic people only.
 */

const JANE = { name: 'Jane Sample', dateOfBirth: '1970-03-14' }

function post(body: unknown) {
  return new NextRequest('http://localhost/api/portal/company-details', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

/** `existing` decides update vs insert; the spies record what was written. */
function mockTable(existing: { id: string } | null, row: Record<string, unknown> | null = null) {
  const update = vi.fn<(columns: Record<string, unknown>) => unknown>(() => ({
    eq: () => Promise.resolve({ error: null }),
  }))
  const insert = vi.fn<(row: Record<string, unknown>) => unknown>(() => Promise.resolve({ error: null }))
  const select = vi.fn((columns: string) => ({
    eq: () => ({
      maybeSingle: () => Promise.resolve({ data: columns === 'id' ? existing : row, error: null }),
    }),
  }))
  vi.mocked(getSupabaseServerClient).mockReturnValue({
    from: () => ({ select, update, insert }),
  } as never)
  return { update, insert }
}

beforeEach(() => {
  vi.mocked(requireStaffUser).mockResolvedValue({ id: 'staff-1' } as never)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('POST /api/portal/company-details', () => {
  it('answers 401 without a staff session', async () => {
    vi.mocked(requireStaffUser).mockResolvedValue(null)
    const { update, insert } = mockTable({ id: 'cd_1' })
    expect((await POST(post({ clientId: 'cl_1', directors: [JANE] }))).status).toBe(401)
    expect(update).not.toHaveBeenCalled()
    expect(insert).not.toHaveBeenCalled()
  })

  it('leaves the directors and addresses untouched on a register-only save', async () => {
    const { update } = mockTable({ id: 'cd_1' })

    // What intake step 1 sends after a business register lookup.
    const response = await POST(
      post({ clientId: 'cl_1', companyName: 'Sample Trading Pty Ltd', abnNumber: '11123456780' }),
    )

    expect(response.status).toBe(200)
    const written = update.mock.calls[0][0]
    expect(written).toMatchObject({
      company_name: 'Sample Trading Pty Ltd',
      abn_number: '11123456780',
    })
    for (const column of [
      'directors',
      'registered_office_address',
      'principal_place_of_business',
      'asic_extract_date',
      'company_details_source',
      'phone_number',
    ]) {
      expect(written).not.toHaveProperty(column)
    }
  })

  it('writes the ASIC fields when the company step sends them', async () => {
    const { update } = mockTable({ id: 'cd_1' })

    await POST(
      post({
        clientId: 'cl_1',
        registeredOfficeAddress: '1 Sample Road',
        principalPlaceOfBusiness: '1 Sample Road',
        directors: [JANE],
        asicExtractDate: '2026-09-23T14:07:38+10:00',
        companyDetailsSource: 'asic_pdf_edited',
      }),
    )

    expect(update.mock.calls[0][0]).toMatchObject({
      registered_office_address: '1 Sample Road',
      principal_place_of_business: '1 Sample Road',
      directors: [JANE],
      asic_extract_date: '2026-09-23T14:07:38+10:00',
      company_details_source: 'asic_pdf_edited',
    })
  })

  it('removes the directors only when an empty array is sent', async () => {
    const { update } = mockTable({ id: 'cd_1' })
    await POST(post({ clientId: 'cl_1', directors: [] }))
    expect(update.mock.calls[0][0]).toMatchObject({ directors: [] })
  })

  it('inserts a first record with no directors as an empty list', async () => {
    const { insert } = mockTable(null)
    await POST(post({ clientId: 'cl_1', companyName: 'Sample Trading Pty Ltd' }))
    expect(insert.mock.calls[0][0]).toMatchObject({
      client_id: 'cl_1',
      company_name: 'Sample Trading Pty Ltd',
      directors: [],
      company_details_source: null,
    })
  })

  it.each([
    [
      'a date of birth in the wrong shape',
      { directors: [{ name: 'Jane Sample', dateOfBirth: '14/03/1970' }] },
    ],
    ['directors that are not an array', { directors: { name: 'Jane Sample' } }],
    ['a source outside the three', { companyDetailsSource: 'made_up' }],
    ['a field that is not text', { companyName: 42 }],
  ])('400 for %s, writing nothing', async (_, fields) => {
    const { update, insert } = mockTable({ id: 'cd_1' })
    const response = await POST(post({ clientId: 'cl_1', ...fields }))
    expect(response.status).toBe(400)
    expect(update).not.toHaveBeenCalled()
    expect(insert).not.toHaveBeenCalled()
  })

  it('400 for a missing client, an empty save, or a body that is not JSON', async () => {
    mockTable({ id: 'cd_1' })
    expect((await POST(post({ companyName: 'Sample Trading Pty Ltd' }))).status).toBe(400)
    expect((await POST(post({ clientId: 'cl_1' }))).status).toBe(400)
    expect((await POST(post('not json'))).status).toBe(400)
  })

  it('never stores an unknown field, or anything extra about a director', async () => {
    const { update } = mockTable({ id: 'cd_1' })
    await POST(
      post({
        clientId: 'cl_1',
        shareholders: ['Holly Shareholder'],
        directors: [{ ...JANE, placeOfBirth: 'BIRTHVILLE' }],
      }),
    )
    const written = JSON.stringify(update.mock.calls[0][0])
    expect(written).not.toContain('Holly')
    expect(written).not.toContain('BIRTHVILLE')
  })
})

describe('GET /api/portal/company-details', () => {
  it('returns the ASIC fields with the rest of the record', async () => {
    mockTable(null, {
      id: 'cd_1',
      client_id: 'cl_1',
      company_name: 'Sample Trading Pty Ltd',
      registered_office_address: '1 Sample Road',
      principal_place_of_business: '2 Sample Road',
      directors: [JANE],
      asic_extract_date: '2026-09-23T04:07:38+00:00',
      company_details_source: 'asic_pdf',
    })
    const response = await GET(
      new NextRequest('http://localhost/api/portal/company-details?clientId=cl_1'),
    )
    expect(await response.json()).toMatchObject({
      companyName: 'Sample Trading Pty Ltd',
      registeredOfficeAddress: '1 Sample Road',
      principalPlaceOfBusiness: '2 Sample Road',
      directors: [JANE],
      asicExtractDate: '2026-09-23T04:07:38+00:00',
      companyDetailsSource: 'asic_pdf',
    })
  })
})
