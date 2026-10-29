// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/supabase/server', () => ({ getSupabaseServerClient: vi.fn(), getSupabaseAuthClient: vi.fn() }))
vi.mock('@/lib/auth/staff', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/staff')>()),
  requireStaffUser: vi.fn(),
}))
vi.mock('@/lib/asic/readUpload', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/asic/readUpload')>()),
  readAsicUpload: vi.fn(),
}))

import { getSupabaseServerClient } from '@/lib/supabase/server'
import { requireStaffUser } from '@/lib/auth/staff'
import { readAsicUpload } from '@/lib/asic/readUpload'
import { POST } from '../route'
import { GET } from '../[extractId]/route'

/** Keeping an ASIC extract on the client file (migration 0041). Synthetic data only. */

const PARAMS = { params: Promise.resolve({ id: 'cl_1' }) }
const req = () => new NextRequest('http://localhost/api/admin/clients/cl_1/asic-extract', { method: 'POST' })

const EXTRACT = {
  companyName: 'Sample Trading Pty Ltd',
  acn: '123456780',
  abn: '11123456780',
  status: 'Registered',
  registeredOn: '2014-06-12',
  registeredOffice: '1 Sample Road',
  principalPlaceOfBusiness: '1 Sample Road',
  directors: [{ name: 'JANE SAMPLE', dateOfBirth: '1970-03-14', appointedOn: '2016-08-05' }],
  extractType: 'current' as const,
  extractedAt: '2026-09-23T14:07:38+10:00',
  warnings: [],
}

function mockDb({
  client = { id: 'cl_1', archived_at: null } as { id: string; archived_at: string | null } | null,
  company = { acn_number: '123 456 780', directors: [{ name: 'Jane Sample', dateOfBirth: '1970-03-14' }] } as Record<string, unknown> | null,
  rowError = null as { message: string } | null,
} = {}) {
  const upload = vi.fn(() => Promise.resolve({ error: null }))
  const remove = vi.fn(() => Promise.resolve({ error: null }))
  const insert = vi.fn(() => ({ select: () => ({ single: () => Promise.resolve({ data: rowError ? null : { id: 'ex-1' }, error: rowError }) }) }))
  const update = vi.fn(() => ({ eq: () => Promise.resolve({ error: null }) }))
  const one = (data: unknown) => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data }) }) }) })
  const tables: Record<string, unknown> = {
    clients: one(client),
    company_details: { ...one(company), update },
    client_asic_extracts: { insert },
  }
  vi.mocked(getSupabaseServerClient).mockReturnValue({
    from: (t: string) => tables[t],
    storage: { from: () => ({ upload, remove }) },
  } as never)
  return { upload, remove, insert, update }
}

beforeEach(() => {
  vi.mocked(requireStaffUser).mockResolvedValue({ id: 's1', email: 'casey@example.com', user_metadata: { full_name: 'Casey Staff' } } as never)
  vi.mocked(readAsicUpload).mockResolvedValue({
    ok: true,
    bytes: new Uint8Array([37, 80, 68, 70]),
    pageCount: 3,
    extract: EXTRACT,
    pages: { organisation: 1, addresses: 1, directors: 2 },
  })
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('POST /api/admin/clients/[id]/asic-extract', () => {
  it('needs a session, a client, and a file not archived', async () => {
    vi.mocked(requireStaffUser).mockResolvedValueOnce(null)
    expect((await POST(req(), PARAMS)).status).toBe(401)
    mockDb({ client: null })
    expect((await POST(req(), PARAMS)).status).toBe(404)
    mockDb({ client: { id: 'cl_1', archived_at: '2026-10-01T00:00:00Z' } })
    expect((await POST(req(), PARAMS)).status).toBe(409)
  })

  it('refuses what the upload checks refuse, exactly as the parse-only route does', async () => {
    mockDb()
    vi.mocked(readAsicUpload).mockResolvedValueOnce({ ok: false, response: NextResponse.json({ error: 'not a PDF' }, { status: 415 }) })
    expect((await POST(req(), PARAMS)).status).toBe(415)
  })

  it('refuses an extract for another company, and keeps nothing', async () => {
    const { upload, insert } = mockDb({ company: { acn_number: '000000019', directors: [] } })
    expect((await POST(req(), PARAMS)).status).toBe(409)
    expect(upload).not.toHaveBeenCalled()
    expect(insert).not.toHaveBeenCalled()
  })

  it('keeps the file privately, records where each part is, and writes only the two dates', async () => {
    const { upload, insert, update } = mockDb()
    const res = await POST(req(), PARAMS)
    expect(res.status).toBe(201)

    const [path, , options] = upload.mock.calls[0] as unknown as [string, Uint8Array, { contentType: string }]
    expect(path).toMatch(/^cl_1\/asic\/[0-9a-f-]{36}\.pdf$/)
    expect(options.contentType).toBe('application/pdf')
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        client_id: 'cl_1',
        file_path: path,
        page_count: 3,
        acn: '123456780',
        section_pages: { organisation: 1, addresses: 1, directors: 2 },
        uploaded_by: 'Casey',
      }),
    )
    const written = (update.mock.calls[0] as unknown as [Record<string, unknown>])[0]
    expect(written).toMatchObject({
      registration_date: '2014-06-12',
      // The name stays as staff saved it; only the date is added.
      directors: [{ name: 'Jane Sample', dateOfBirth: '1970-03-14', appointedOn: '2016-08-05' }],
    })
    expect(Object.keys(written).sort()).toEqual(['directors', 'registration_date', 'updated_at'])
    expect(await res.json()).toEqual({ id: 'ex-1', pageCount: 3, registeredOn: '2014-06-12', appointmentDates: 1 })
  })

  it('removes the file again when its row cannot be written', async () => {
    const { remove, update } = mockDb({ rowError: { message: 'boom' } })
    expect((await POST(req(), PARAMS)).status).toBe(500)
    expect(remove).toHaveBeenCalledTimes(1)
    expect(update).not.toHaveBeenCalled()
  })
})

describe('GET /api/admin/clients/[id]/asic-extract/[extractId]', () => {
  function mockRow(row: { file_path: string; page_count: number } | null) {
    const createSignedUrl = vi.fn(() => Promise.resolve({ data: { signedUrl: 'https://storage.example.test/signed' }, error: null }))
    vi.mocked(getSupabaseServerClient).mockReturnValue({
      from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: row }) }) }) }) }),
      storage: { from: () => ({ createSignedUrl }) },
    } as never)
    return createSignedUrl
  }
  const get = (page: string) =>
    GET(new NextRequest(`http://localhost/api/admin/clients/cl_1/asic-extract/ex-1?page=${page}`), {
      params: Promise.resolve({ id: 'cl_1', extractId: 'ex-1' }),
    })

  it('opens the kept file at its page with a 300-second signed link', async () => {
    const sign = mockRow({ file_path: 'cl_1/asic/x.pdf', page_count: 3 })
    const res = await get('2')
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('https://storage.example.test/signed#page=2')
    expect(sign).toHaveBeenCalledWith('cl_1/asic/x.pdf', 300)
  })

  it('ignores a page the file does not have, and answers 404 for another client’s extract', async () => {
    mockRow({ file_path: 'cl_1/asic/x.pdf', page_count: 3 })
    expect((await get('9')).headers.get('location')).toBe('https://storage.example.test/signed')
    mockRow(null)
    expect((await get('1')).status).toBe(404)
  })
})
