// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase/server', () => ({ getSupabaseServerClient: vi.fn() }))
vi.mock('@/lib/auth/staff', () => ({
  requireStaffUser: vi.fn(),
  staffAuthorName: () => 'Sam',
}))
vi.mock('@/lib/dpn/store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/dpn/store')>()),
  readAndStoreNotice: vi.fn(),
}))

import { getSupabaseServerClient } from '@/lib/supabase/server'
import { requireStaffUser } from '@/lib/auth/staff'
import { readAndStoreNotice } from '@/lib/dpn/store'
import { PUT } from '../[documentId]/route'
import { POST as READ } from '../[documentId]/read/route'
import { POST as NONE_ISSUED } from '../none-issued/route'

/** The director penalty notice routes, against a mocked Supabase. Synthetic data only. */

const PARAMS = { params: Promise.resolve({ id: 'client-1', documentId: 'doc-1' }) }

function request(body: unknown, method = 'POST') {
  return new NextRequest('http://localhost/api/x', { method, body: JSON.stringify(body) })
}

/** A chain that answers every filter and ends in the given result. */
function chain(result: unknown) {
  const node: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'update']) node[method] = vi.fn(() => node)
  node.maybeSingle = vi.fn(() => Promise.resolve(result))
  node.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve)
  return node
}

beforeEach(() => {
  vi.mocked(requireStaffUser).mockResolvedValue({ id: 'staff-1' } as never)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

const MANUAL = {
  reference: '1234567890123',
  issuedOn: '2026-09-30',
  type: 'paygw',
  companyName: 'EXAMPLE TRADING PTY LTD',
  acn: '000 000 019',
  directorName: 'Jane Sample',
  rows: [
    { periodFrom: '2025-01-01', periodTo: '2025-03-31', column2: 100_00, column3: 90_00, column4: 80_00, column5: 10_00 },
    { periodFrom: '2024-10-01', periodTo: '2024-12-31', column2: 50_00, column3: 50_00, column4: 0, column5: 50_00 },
  ],
}

describe('PUT a manual entry', () => {
  function mock(docFound = true) {
    const upsert = vi.fn<(values: Record<string, unknown>, opts: unknown) => Promise<{ error: null }>>(() =>
      Promise.resolve({ error: null }),
    )
    vi.mocked(getSupabaseServerClient).mockReturnValue({
      from: (table: string) =>
        table === 'documents' ? chain({ data: docFound ? { id: 'doc-1' } : null }) : { upsert },
    } as never)
    return upsert
  }

  it('stores it as entered manually, by whom, with totals worked out here', async () => {
    const upsert = mock()
    const response = await PUT(request({ ...MANUAL, totals: { column3: 1 } }, 'PUT'), PARAMS)
    expect(response.status).toBe(200)
    const [values, opts] = upsert.mock.calls[0]
    expect(opts).toEqual({ onConflict: 'document_id' })
    expect(values).toMatchObject({
      client_id: 'client-1',
      document_id: 'doc-1',
      source: 'manual',
      status: 'read',
      entered_by: 'Sam',
      acn: '000000019',
      total_column2: 150_00,
      total_column3: 140_00,
      total_column4: 80_00,
      total_column5: 60_00,
    })
  })

  it('refuses an incomplete notice with the reason', async () => {
    mock()
    const response = await PUT(request({ ...MANUAL, acn: '12' }, 'PUT'), PARAMS)
    expect(response.status).toBe(400)
    expect((await response.json()).error).toBe('An ACN is 9 digits.')
  })

  it("refuses a document that is not this client's DPN", async () => {
    const upsert = mock(false)
    const response = await PUT(request(MANUAL, 'PUT'), PARAMS)
    expect(response.status).toBe(404)
    expect(upsert).not.toHaveBeenCalled()
  })
})

describe('POST read', () => {
  function mock() {
    vi.mocked(getSupabaseServerClient).mockReturnValue({
      from: () => chain({ data: { id: 'doc-1', client_id: 'client-1', file_path: 'client-1/a.pdf' } }),
    } as never)
  }

  it('reports what the read found', async () => {
    mock()
    vi.mocked(readAndStoreNotice).mockResolvedValue({ kind: 'stored', status: 'read', manualReason: null })
    const response = await READ(request({}), PARAMS)
    expect(await response.json()).toEqual({ status: 'read', manualReason: null })
  })

  it('answers 409 for a manual entry, which is never re-read', async () => {
    mock()
    vi.mocked(readAndStoreNotice).mockResolvedValue({ kind: 'kept_manual' })
    const response = await READ(request({}), PARAMS)
    expect(response.status).toBe(409)
  })
})

describe('POST none-issued', () => {
  function mock(dpnCount: number) {
    const updated = chain({ data: { id: 'client-1' }, error: null })
    vi.mocked(getSupabaseServerClient).mockReturnValue({
      from: (table: string) =>
        table === 'documents' ? chain({ count: dpnCount, error: null }) : updated,
    } as never)
    return updated.update as ReturnType<typeof vi.fn>
  }

  it('records who ticked it and clears any old note', async () => {
    const update = mock(0)
    const response = await NONE_ISSUED(request({ confirmed: true }), PARAMS)
    expect(response.status).toBe(200)
    expect(update.mock.calls[0][0]).toMatchObject({
      no_dpn_confirmed_by: 'Sam',
      no_dpn_cleared_at: null,
      no_dpn_cleared_note: null,
    })
  })

  it('refuses the tick while a notice is on file', async () => {
    const update = mock(1)
    const response = await NONE_ISSUED(request({ confirmed: true }), PARAMS)
    expect(response.status).toBe(409)
    expect(update).not.toHaveBeenCalled()
  })

  it('unticks without checking for notices', async () => {
    const update = mock(3)
    await NONE_ISSUED(request({ confirmed: false }), PARAMS)
    expect(update.mock.calls[0][0]).toEqual({ no_dpn_confirmed_at: null, no_dpn_confirmed_by: null })
  })

  it('refuses a caller who is not staff', async () => {
    vi.mocked(requireStaffUser).mockResolvedValue(null as never)
    mock(0)
    expect((await NONE_ISSUED(request({ confirmed: true }), PARAMS)).status).toBe(401)
  })
})
