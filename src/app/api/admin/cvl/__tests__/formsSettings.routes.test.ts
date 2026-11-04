// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase/server', () => ({ getSupabaseServerClient: vi.fn(), getSupabaseAuthClient: vi.fn() }))
vi.mock('@/lib/auth/staff', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/staff')>()),
  requireStaffUser: vi.fn(),
}))

import { getSupabaseServerClient } from '@/lib/supabase/server'
import { requireStaffUser } from '@/lib/auth/staff'
import { DELETE, PUT } from '../[caseId]/forms/[form]/route'
import { PUT as putSetting } from '../settings/route'

/** Saving entry-screen drafts and CVL settings. Synthetic data only. */

const params = (form: string) => ({ params: Promise.resolve({ caseId: 'case-1', form }) })
const put = (body: unknown) => new NextRequest('http://localhost/api/admin/cvl/case-1/forms/x', { method: 'PUT', body: JSON.stringify(body) })

function mockDb(client: { archived_at: string | null; workflow: string } | null = { archived_at: null, workflow: 'cvl' }) {
  const upsert = vi.fn<(row: Record<string, unknown>, opts: unknown) => Promise<{ error: null }>>(() => Promise.resolve({ error: null }))
  const del = vi.fn(() => ({ eq: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }) }))
  vi.mocked(getSupabaseServerClient).mockReturnValue({
    from: (t: string) =>
      t === 'cvl_cases'
        ? { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: client ? { id: 'case-1', client_id: 'cl_1', clients: client } : null }) }) }) }
        : t === 'cvl_settings'
          ? { upsert, select: () => Promise.resolve({ data: [] }) }
          : { upsert, delete: del },
  } as never)
  return { upsert, del }
}

beforeEach(() => {
  vi.mocked(requireStaffUser).mockResolvedValue({ id: 's1', email: 'casey@example.com', user_metadata: { full_name: 'Casey Staff' } } as never)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('PUT /api/admin/cvl/[caseId]/forms/[form]', () => {
  it('saves the draft with the form version, never a handwritten answer', async () => {
    const { upsert } = mockDb()
    const res = await PUT(
      put({
        subject: 'director:2',
        answers: { fields: { b1_name: 'Casey Example', b6_password: 'secret', b1_street: '1 Home St' }, tables: {}, signedBy: 'Casey Example' },
        editedKeys: ['b1_name', 'b6_password'],
      }),
      params('507b'),
    )
    expect(res.status).toBe(200)
    const [row, opts] = upsert.mock.calls[0]
    expect(row).toMatchObject({
      case_id: 'case-1',
      form_code: '507b',
      form_version: '20220801',
      subject: 'director:2',
      answers: { fields: { b1_name: 'Casey Example' }, tables: {}, signedBy: 'Casey Example' },
      edited_keys: ['b1_name'],
      updated_by: 'Casey',
    })
    expect(JSON.stringify(row)).not.toContain('secret')
    expect(JSON.stringify(row)).not.toContain('Home St')
    expect(opts).toEqual({ onConflict: 'case_id,form_code,subject' })
  })

  it('refuses an unknown form, a subject that does not fit it, and answers that are not answers', async () => {
    mockDb()
    expect((await PUT(put({ subject: 'company', answers: { fields: {} } }), params('999'))).status).toBe(404)
    expect((await PUT(put({ subject: 'company', answers: { fields: {} } }), params('507b'))).status).toBe(400)
    expect((await PUT(put({ subject: 'director:1', answers: { fields: {} } }), params('509'))).status).toBe(400)
    expect((await PUT(put({ subject: 'company', answers: 'x' }), params('509'))).status).toBe(400)
  })

  it('writes nothing for a file that is archived or back in SBR', async () => {
    const { upsert } = mockDb({ archived_at: '2026-10-01T00:00:00Z', workflow: 'cvl' })
    expect((await PUT(put({ subject: 'company', answers: { fields: {} } }), params('509'))).status).toBe(409)
    mockDb({ archived_at: null, workflow: 'sbr' })
    expect((await PUT(put({ subject: 'company', answers: { fields: {} } }), params('509'))).status).toBe(409)
    expect(upsert).not.toHaveBeenCalled()
  })

  it('goes back to the pre-filled answers by removing the draft', async () => {
    const { del } = mockDb()
    const res = await DELETE(new NextRequest('http://localhost/api/admin/cvl/case-1/forms/509?subject=company', { method: 'DELETE' }), params('509'))
    expect(res.status).toBe(200)
    expect(del).toHaveBeenCalled()
  })
})

describe('PUT /api/admin/cvl/settings', () => {
  const putReq = (body: unknown) => new NextRequest('http://localhost/api/admin/cvl/settings', { method: 'PUT', body: JSON.stringify(body) })

  it('saves a setting checked against its kind, with who changed it', async () => {
    const { upsert } = mockDb()
    const res = await putSetting(putReq({ key: 'f509_place.super_payable', value: 'r3', confirmed: true }))
    expect(res.status).toBe(200)
    expect(upsert.mock.calls[0][0]).toMatchObject({ key: 'f509_place.super_payable', value: 'r3', confirmed: true, updated_by: 'Casey' })
  })

  it('cannot confirm a blank setting, and refuses unknown keys and values', async () => {
    const { upsert } = mockDb()
    await putSetting(putReq({ key: 'external_administrator', value: null, confirmed: true }))
    expect(upsert.mock.calls[0][0]).toMatchObject({ key: 'external_administrator', value: null, confirmed: false })
    expect((await putSetting(putReq({ key: 'nonsense', value: 'x', confirmed: false }))).status).toBe(400)
    expect((await putSetting(putReq({ key: 'f509_place.director_loan', value: 'r6', confirmed: false }))).status).toBe(400)
  })
})
