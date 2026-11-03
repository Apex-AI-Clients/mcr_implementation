// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { extractText, getDocumentProxy } from 'unpdf'

vi.mock('@/lib/supabase/server', () => ({ getSupabaseServerClient: vi.fn(), getSupabaseAuthClient: vi.fn() }))
vi.mock('@/lib/auth/staff', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/staff')>()),
  requireStaffUser: vi.fn(),
}))
vi.mock('@/lib/cvl/context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/cvl/context')>()),
  loadCvlContext: vi.fn(),
}))

import { getSupabaseServerClient } from '@/lib/supabase/server'
import { requireStaffUser } from '@/lib/auth/staff'
import { loadCvlContext } from '@/lib/cvl/context'
import { GET as preview, POST as previewPost } from '../[caseId]/preview/route'
import { POST as generate } from '../[caseId]/generate/route'
import { GET as openDoc } from '../[caseId]/documents/[docId]/route'
import { context } from '@/lib/cvl/__tests__/fixtures'

// Each test fills real ASIC PDFs; under full-suite load that can pass 20s.
vi.setConfig({ testTimeout: 60_000 })

/** Preview, print and save. Synthetic client file only; nothing real is filled or stored. */

const PARAMS = { params: Promise.resolve({ caseId: 'case-1' }) }

function mockDb({
  open = true,
  status = 'draft',
  saved = [] as { form_code: string; subject: string }[],
  rowError = null as { message: string } | null,
} = {}) {
  const upload = vi.fn<(path: string, body: Uint8Array, opts: unknown) => Promise<{ error: null }>>(() => Promise.resolve({ error: null }))
  const remove = vi.fn(() => Promise.resolve({ error: null }))
  const createSignedUrl = vi.fn(() => Promise.resolve({ data: { signedUrl: 'https://storage.example.test/signed' }, error: null }))
  const insert = vi.fn<(row: Record<string, unknown>) => unknown>((row) => ({
    select: () => ({ single: () => Promise.resolve(rowError ? { data: null, error: rowError } : { data: { id: 'doc-1', generated_at: row.generated_at }, error: null }) }),
  }))
  const caseUpdate = vi.fn<(row: Record<string, unknown>) => unknown>(() => ({ eq: () => Promise.resolve({ error: null }) }))
  const caseRow = {
    id: 'case-1',
    client_id: 'cl_1',
    status,
    forms_prepared_at: null,
    printed_at: null,
    clients: { name: 'Example Trading client', archived_at: null, workflow: open ? 'cvl' : 'sbr' },
  }
  vi.mocked(getSupabaseServerClient).mockReturnValue({
    from: (t: string) => {
      if (t === 'cvl_cases') return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: caseRow }) }) }), update: caseUpdate }
      if (t === 'cvl_form_answers') return { select: () => ({ eq: () => Promise.resolve({ data: [] }) }) }
      if (t === 'cvl_generated_documents')
        return {
          insert,
          select: () => ({
            eq: (_c: string, v: string) =>
              v === 'doc-1'
                ? { eq: () => ({ maybeSingle: () => Promise.resolve({ data: { file_path: 'cl_1/cvl/x.pdf', form_code: '507b', subject: 'director:1', generated_at: '2026-11-03T00:00:00Z' } }) }) }
                : Promise.resolve({ data: [...saved, ...insert.mock.calls.map((c) => ({ form_code: c[0].form_code as string, subject: c[0].subject as string }))] }),
          }),
        }
      throw new Error(`unexpected table ${t}`)
    },
    storage: { from: () => ({ upload, remove, createSignedUrl }) },
  } as never)
  return { upload, remove, insert, caseUpdate, createSignedUrl }
}

const json = (url: string, body: unknown) => new NextRequest(url, { method: 'POST', body: JSON.stringify(body) })
const text = async (res: Response) => (await extractText(await getDocumentProxy(new Uint8Array(await res.arrayBuffer())), { mergePages: true })).text

beforeEach(() => {
  vi.mocked(requireStaffUser).mockResolvedValue({ id: 's1', email: 'casey@example.com', user_metadata: { full_name: 'Casey Staff' } } as never)
  vi.mocked(loadCvlContext).mockResolvedValue(context())
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('preview', () => {
  it('shows a form as it would print, with what to check, and saves nothing', async () => {
    const { upload, insert } = mockDb()
    const res = await preview(new NextRequest('http://localhost/api/admin/cvl/case-1/preview?form=507b&subject=director:2'), PARAMS)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(res.headers.get('cache-control')).toBe('no-store')
    const warnings = JSON.parse(decodeURIComponent(res.headers.get('x-cvl-warnings')!))
    expect(warnings).toContain('Never opened: printed from the pre-filled answers.')
    expect(await text(res)).toContain('Casey Example')
    expect(upload).not.toHaveBeenCalled()
    expect(insert).not.toHaveBeenCalled()
  })

  it('answers 404 for a director the file does not have', async () => {
    mockDb()
    expect((await preview(new NextRequest('http://localhost/api/admin/cvl/case-1/preview?form=507b&subject=director:5'), PARAMS)).status).toBe(404)
  })

  it('previews the answers on screen, never drawing a handwritten one', async () => {
    mockDb()
    const res = await previewPost(
      json('http://localhost/api/admin/cvl/case-1/preview', {
        form: '507b',
        subject: 'director:1',
        answers: { fields: { b1_name: 'Typed On Screen', b6_password: 'hunter2', b1_street: '1 Home Street' }, tables: {}, signedBy: null },
      }),
      PARAMS,
    )
    expect(res.status).toBe(200)
    const t = await text(res)
    expect(t).toContain('Typed On Screen')
    expect(t).not.toContain('hunter2')
    expect(t).not.toContain('Home Street')
  })
})

describe('generate', () => {
  it('keeps one form privately, with what it was made from, who and when', async () => {
    const { upload, insert, caseUpdate } = mockDb()
    const res = await generate(json('http://localhost/api/admin/cvl/case-1/generate', { form: '507b', subject: 'director:1' }), PARAMS)
    expect(res.status).toBe(201)
    const [path, , opts] = upload.mock.calls[0]
    expect(path).toMatch(/^cl_1\/cvl\/[0-9a-f-]{36}\.pdf$/)
    expect(opts).toEqual({ contentType: 'application/pdf', upsert: false })
    const row = insert.mock.calls[0][0]
    expect(row).toMatchObject({
      case_id: 'case-1',
      client_id: 'cl_1',
      form_code: '507b',
      subject: 'director:1',
      form_versions: { '507b': '20220801' },
      file_path: path,
      generated_by: 'Casey',
    })
    expect(JSON.stringify(row.answers_snapshot)).toContain('Jordan Sample')
    // Not every form saved yet: still Draft.
    expect(caseUpdate).not.toHaveBeenCalled()
    expect((await res.json()).status).toBe('draft')
  })

  it('makes the case Forms prepared once all forms are saved in one file', async () => {
    const { insert, caseUpdate } = mockDb()
    const res = await generate(json('http://localhost/api/admin/cvl/case-1/generate', { form: 'all' }), PARAMS)
    expect(res.status).toBe(201)
    const row = insert.mock.calls[0][0]
    expect(row).toMatchObject({ form_code: 'all', subject: 'all', form_versions: { '509': '2011', '507a': '20220801', '507b': '20220801' } })
    expect((row.answers_snapshot as unknown[]).length).toBe(4)
    expect(caseUpdate.mock.calls[0][0]).toMatchObject({ status: 'forms_prepared', printed_at: null })
    expect((await res.json()).status).toBe('forms_prepared')
  })

  it('removes the file again when its record cannot be written', async () => {
    const { remove } = mockDb({ rowError: { message: 'boom' } })
    expect((await generate(json('http://localhost/api/admin/cvl/case-1/generate', { form: '509' }), PARAMS)).status).toBe(500)
    expect(remove).toHaveBeenCalledTimes(1)
  })

  it('generates nothing for a file not open in CVL, or a form that does not exist', async () => {
    const { upload } = mockDb({ open: false })
    expect((await generate(json('http://localhost/api/admin/cvl/case-1/generate', { form: 'all' }), PARAMS)).status).toBe(409)
    expect((await generate(json('http://localhost/api/admin/cvl/case-1/generate', { form: '999' }), PARAMS)).status).toBe(400)
    expect(upload).not.toHaveBeenCalled()
  })
})

describe('opening a saved file', () => {
  it('redirects to a 300-second signed link, named for download when asked', async () => {
    const { createSignedUrl } = mockDb()
    const p = { params: Promise.resolve({ caseId: 'case-1', docId: 'doc-1' }) }
    const res = await openDoc(new NextRequest('http://localhost/api/admin/cvl/case-1/documents/doc-1?download=1'), p)
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('https://storage.example.test/signed')
    expect(createSignedUrl).toHaveBeenCalledWith('cl_1/cvl/x.pdf', 300, { download: 'form-507-part-b-director-1-2026-11-03.pdf' })
  })
})
