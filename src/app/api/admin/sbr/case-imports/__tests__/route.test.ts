// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase/server', () => ({ getSupabaseServerClient: vi.fn() }))
vi.mock('@/lib/auth/staff', () => ({ requireStaffUser: vi.fn(), staffAuthorName: () => 'Sam' }))

import { getSupabaseServerClient } from '@/lib/supabase/server'
import { requireStaffUser } from '@/lib/auth/staff'
import { BASE_CELLS, TEMPLATE_HEADER, csvLine, existingCase } from '@/lib/sbr/import/__tests__/fixtures'
import { MAX_UPLOAD_BYTES } from '@/lib/sbr/import/config'
import { POST as previewPOST } from '../preview/route'
import { GET as historyGET, POST as confirmPOST } from '../route'
import { POST as undoPOST } from '../[id]/undo/route'
import { GET as templateGET } from '../template/route'

/**
 * The historical-case import routes, against a mocked database. Synthetic
 * names and figures only.
 */

const STAFF_ID = '22222222-2222-4222-8222-222222222222'
const IMPORT_ID = '33333333-3333-4333-8333-333333333333'

const ALPHA = existingCase({ clientName: 'Alpha Pty Ltd' })
const BRAVO = existingCase({ clientName: 'Bravo Pty Ltd' }, { business_type: 'Retail', number_of_creditors: 2 })

/** The stored cases as the table returns them. */
const STORED_ROWS = [ALPHA, BRAVO].map((c) => ({
  id: c.id,
  name_key: c.name_key,
  excluded: c.excluded,
  excluded_reason: c.excluded_reason,
  ...c.record,
}))

/** Alpha: same figures (details added). Bravo: payment differs (correction). Charlie: new. Delta: rejected. */
const FILE_CSV = [
  TEMPLATE_HEADER,
  csvLine({ ...BASE_CELLS, clientName: 'Alpha Pty Ltd' }),
  csvLine({ ...BASE_CELLS, clientName: 'Bravo Pty Ltd', sbrPayment: '95,000' }),
  csvLine({ ...BASE_CELLS, clientName: 'Charlie Pty Ltd' }),
  csvLine({ ...BASE_CELLS, clientName: 'Delta Pty Ltd', paymentType: 'Upfront and Plan' }),
].join('\n')

function multipart(url: string, file: { name: string; body: BlobPart } | null, fields: Record<string, string> = {}) {
  const form = new FormData()
  if (file) form.set('file', new File([file.body], file.name))
  for (const [k, v] of Object.entries(fields)) form.set(k, v)
  return new NextRequest(url, { method: 'POST', body: form })
}

const PREVIEW_URL = 'http://localhost/api/admin/sbr/case-imports/preview'
const CONFIRM_URL = 'http://localhost/api/admin/sbr/case-imports'

type RpcResult = { data: unknown; error: { code?: string; message: string } | null }

function mockDb(rpcResult: RpcResult = { data: IMPORT_ID, error: null }) {
  const rpc = vi.fn<(name: string, args: unknown) => Promise<RpcResult>>(() => Promise.resolve(rpcResult))
  const history = [
    {
      id: IMPORT_ID,
      uploaded_at: '2026-10-13T00:00:00Z',
      uploaded_by: 'Sam',
      file_name: 'cases.xlsx',
      counts: { added: 1 },
      undone_at: null,
      undone_by: null,
    },
  ]
  const from = vi.fn((table: string) => ({
    select: () =>
      table === 'sbr_historical_cases'
        ? Promise.resolve({ data: STORED_ROWS, error: null })
        : { order: () => Promise.resolve({ data: history, error: null }) },
  }))
  vi.mocked(getSupabaseServerClient).mockReturnValue({ from, rpc } as never)
  return { rpc, from }
}

let info: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.mocked(requireStaffUser).mockResolvedValue({ id: STAFF_ID } as never)
  info = vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

/** Nothing from the file (names, file name) reaches the logs. */
function expectNothingFromTheFileLogged() {
  const logged = JSON.stringify(info.mock.calls)
  for (const s of ['Alpha', 'Bravo', 'Charlie', 'Delta', 'cases.csv']) expect(logged).not.toContain(s)
}

describe('POST preview', () => {
  it('refuses without a session', async () => {
    vi.mocked(requireStaffUser).mockResolvedValue(null)
    const res = await previewPOST(multipart(PREVIEW_URL, { name: 'cases.csv', body: FILE_CSV }))
    expect(res.status).toBe(401)
  })

  it('answers what an import would do, and saves nothing', async () => {
    const { rpc } = mockDb()
    const res = await previewPOST(multipart(PREVIEW_URL, { name: 'cases.csv', body: FILE_CSV }))
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toContain('no-store')
    const body = await res.json()
    expect(body.fileName).toBe('cases.csv')
    expect(body.preview.counts).toEqual({ added: 1, corrections: 1, already_have: 1, details_added: 1, rejected: 1 })
    expect(body.preview.corrections[0].changes[0]).toMatchObject({ label: 'SBR payment', from: '$100,000.00', to: '$95,000.00' })
    expect(rpc).not.toHaveBeenCalled()
    expectNothingFromTheFileLogged()
  })

  it('refuses a missing file, a file over the limit and an unreadable file', async () => {
    mockDb()
    expect((await previewPOST(multipart(PREVIEW_URL, null))).status).toBe(400)
    const big = await previewPOST(
      multipart(PREVIEW_URL, { name: 'cases.csv', body: new Uint8Array(MAX_UPLOAD_BYTES + 1) }),
    )
    expect(big.status).toBe(413)
    const fake = await previewPOST(multipart(PREVIEW_URL, { name: 'cases.xlsx', body: 'not a workbook' }))
    expect(fake.status).toBe(422)
    expect((await fake.json()).error).toMatch(/doesn't look like an Excel file/)
  })
})

describe('POST confirm', () => {
  const bravoKey = 'bravo'

  it('re-checks the file and saves new cases, ticked corrections and details in one call', async () => {
    const { rpc } = mockDb()
    const res = await confirmPOST(
      multipart(CONFIRM_URL, { name: 'cases.csv', body: FILE_CSV }, { corrections: JSON.stringify([bravoKey]) }),
    )
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({
      importId: IMPORT_ID,
      counts: { added: 1, corrected: 1, details_added: 1, already_have: 1, corrections_not_applied: 0, rejected: 1 },
    })

    expect(rpc).toHaveBeenCalledTimes(1)
    const [name, args] = rpc.mock.calls[0] as [
      string,
      {
        p_import: Record<string, unknown>
        p_new_cases: { client_name: string }[]
        p_corrections: { case_id: string }[]
      },
    ]
    expect(name).toBe('sbr_apply_case_import')
    expect(args.p_import).toMatchObject({ uploaded_by: 'Sam', uploaded_by_user_id: STAFF_ID, file_name: 'cases.csv' })
    expect(args.p_new_cases.map((c) => c.client_name)).toEqual(['Charlie Pty Ltd'])
    const byCase = Object.fromEntries(args.p_corrections.map((c) => [c.case_id, c]))
    expect(byCase[BRAVO.id]).toMatchObject({ expected: { sbr_payment: 100000 }, values: { sbr_payment: 95000 } })
    expect(byCase[ALPHA.id]).toEqual({
      case_id: ALPHA.id,
      expected: { business_type: null, number_of_creditors: null },
      values: { business_type: 'Cafe & Restaurant', number_of_creditors: 3 },
    })
    expectNothingFromTheFileLogged()
  })

  it('leaves unticked corrections out', async () => {
    const { rpc } = mockDb()
    await confirmPOST(multipart(CONFIRM_URL, { name: 'cases.csv', body: FILE_CSV }))
    const args = rpc.mock.calls[0][1] as { p_corrections: { case_id: string }[] }
    expect(args.p_corrections.map((c) => c.case_id)).toEqual([ALPHA.id])
  })

  it('records nothing when the file would change nothing', async () => {
    const { rpc } = mockDb()
    const same = [TEMPLATE_HEADER, csvLine({ ...BASE_CELLS, clientName: 'Bravo Pty Ltd' })].join('\n')
    const res = await confirmPOST(multipart(CONFIRM_URL, { name: 'cases.csv', body: same }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ importId: null, counts: { added: 0, already_have: 1 } })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('answers 409 when the stored cases changed since the preview', async () => {
    mockDb({ data: null, error: { code: '40001', message: 'sbr_apply_case_import: a case changed since the preview' } })
    const res = await confirmPOST(
      multipart(CONFIRM_URL, { name: 'cases.csv', body: FILE_CSV }, { corrections: JSON.stringify([bravoKey]) }),
    )
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/changed since this file was checked/)
  })

  it('answers 409 when a ticked correction is no longer offered', async () => {
    const { rpc } = mockDb()
    const res = await confirmPOST(
      multipart(CONFIRM_URL, { name: 'cases.csv', body: FILE_CSV }, { corrections: JSON.stringify(['gone']) }),
    )
    expect(res.status).toBe(409)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('refuses a malformed corrections list', async () => {
    mockDb()
    const res = await confirmPOST(
      multipart(CONFIRM_URL, { name: 'cases.csv', body: FILE_CSV }, { corrections: '{"not":"a list"}' }),
    )
    expect(res.status).toBe(400)
  })
})

describe('GET history', () => {
  it('lists the uploads', async () => {
    mockDb()
    const res = await historyGET()
    expect((await res.json()).imports[0]).toMatchObject({ id: IMPORT_ID, uploadedBy: 'Sam', undoneAt: null })
  })
})

describe('POST undo', () => {
  const undo = (id: string) =>
    undoPOST(new NextRequest(`http://localhost/x/${id}/undo`, { method: 'POST' }), {
      params: Promise.resolve({ id }),
    })

  it('undoes the upload as the signed-in staff member', async () => {
    const { rpc } = mockDb({ data: { deleted: 24, restored: 3 }, error: null })
    const res = await undo(IMPORT_ID)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ deleted: 24, restored: 3 })
    expect(rpc).toHaveBeenCalledWith('sbr_undo_case_import', { p_import_id: IMPORT_ID, p_undone_by: 'Sam' })
  })

  it.each([
    [{ code: '55000', message: 'sbr_undo_case_import: a later upload changed the same cases; undo it first' }, 409, /Undo that upload first/],
    [{ code: '55000', message: 'sbr_undo_case_import: this upload is already undone' }, 409, /already undone/],
    [{ code: 'P0002', message: 'sbr_undo_case_import: no such upload' }, 404, /not found/],
  ])('refuses: %o', async (error, status, message) => {
    mockDb({ data: null, error })
    const res = await undo(IMPORT_ID)
    expect(res.status).toBe(status)
    expect((await res.json()).error).toMatch(message)
  })

  it('answers 404 for an id that is not a uuid, without calling the database', async () => {
    const { rpc } = mockDb()
    expect((await undo('not-a-uuid')).status).toBe(404)
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('GET template', () => {
  it('downloads the template CSV', async () => {
    const res = await templateGET()
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8')
    expect(res.headers.get('content-disposition')).toContain('sbr-historical-cases-template.csv')
    const text = await res.text()
    expect(text.replace(/^﻿/, '').split('\r\n')[0]).toBe(TEMPLATE_HEADER)
  })

  it('refuses without a session', async () => {
    vi.mocked(requireStaffUser).mockResolvedValue(null)
    expect((await templateGET()).status).toBe(401)
  })
})
