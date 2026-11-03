// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase/server', () => ({
  getSupabaseServerClient: vi.fn(),
  getSupabaseAuthClient: vi.fn(),
}))

import { getSupabaseAuthClient, getSupabaseServerClient } from '@/lib/supabase/server'
import { POST } from '../route'
import { PATCH } from '../[key]/route'

/**
 * Stages staff add by typing (lead_stages, migration 0042): adding, renaming
 * and hiding one, and the names they can't take. Synthetic data only.
 */

interface StageRow {
  key: string
  label: string
  position: number
  hidden_at: string | null
  built_in: boolean
}

const BUILT_IN: StageRow[] = [
  { key: 'lead', label: 'Lead', position: 0, hidden_at: null, built_in: true },
  { key: 'unresponsive', label: 'Unresponsive', position: 0, hidden_at: null, built_in: true },
]

/** A fake lead_stages / leads pair, enough for the two routes' queries. */
function mockDb({ stages = BUILT_IN, leadsInStage = 0, insertError = null as { code: string } | null } = {}) {
  const rows = stages.map((row) => ({ ...row }))
  const inserted: Record<string, unknown>[] = []
  const updates: { key: string; patch: Record<string, unknown> }[] = []

  const single = (row: StageRow | undefined) => ({ single: () => Promise.resolve({ data: row ?? null, error: null }) })

  const lead_stages = {
    select: () => ({
      // POST reads every row; PATCH reads one by key.
      then: (resolve: (value: unknown) => void) => resolve({ data: rows, error: null }),
      eq: (_column: string, key: string) => ({
        maybeSingle: () => Promise.resolve({ data: rows.find((row) => row.key === key) ?? null, error: null }),
      }),
    }),
    insert: (row: Record<string, unknown>) => {
      inserted.push(row)
      return {
        select: () => ({
          single: () =>
            Promise.resolve(
              insertError
                ? { data: null, error: insertError }
                : { data: { key: row.key, label: row.label, position: row.position, hidden_at: null }, error: null },
            ),
        }),
      }
    },
    update: (patch: Record<string, unknown>) => ({
      eq: (_column: string, key: string) => {
        updates.push({ key, patch })
        const row = rows.find((r) => r.key === key)
        Object.assign(row ?? {}, patch)
        return { select: () => single(row) }
      },
    }),
  }
  const leads = {
    select: () => ({ eq: () => Promise.resolve({ count: leadsInStage, error: null }) }),
  }
  vi.mocked(getSupabaseServerClient).mockReturnValue({
    from: (table: string) => ({ lead_stages, leads })[table],
  } as never)
  return { inserted, updates }
}

function request(method: string, url: string, body: unknown) {
  return new NextRequest(url, { method, body: JSON.stringify(body) })
}

const add = (label: string) => POST(request('POST', 'http://localhost/api/admin/lead-stages', { label }))
const patch = (key: string, body: unknown) =>
  PATCH(request('PATCH', `http://localhost/api/admin/lead-stages/${key}`, body), { params: Promise.resolve({ key }) })

beforeEach(() => {
  vi.mocked(getSupabaseAuthClient).mockResolvedValue({
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'staff-1', email: 'staff@example.test' } }, error: null }) },
  } as never)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('POST /api/admin/lead-stages', () => {
  it('adds a stage with a custom_ key, after the others, as the person who added it', async () => {
    const { inserted } = mockDb({
      stages: [...BUILT_IN, { key: 'custom_aaaa1111', label: 'Waiting', position: 3, hidden_at: null, built_in: false }],
    })
    const response = await add('  Waiting   on  accountant ')
    expect(response.status).toBe(201)
    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toMatchObject({ label: 'Waiting on accountant', built_in: false, position: 4, created_by: 'staff' })
    expect(String(inserted[0].key)).toMatch(/^custom_[0-9a-f]{8}$/)
    expect((await response.json()).stage).toMatchObject({ label: 'Waiting on accountant', hiddenAt: null })
  })

  it("refuses a built-in stage's name, now or as it was called before", async () => {
    mockDb()
    expect((await add('unresponsive')).status).toBe(409)
    expect((await add('Do not contact')).status).toBe(409)
    expect((await add('Non-proceeding – other')).status).toBe(409)
  })

  it('refuses a name another custom stage has, whatever the case', async () => {
    const { inserted } = mockDb({
      stages: [...BUILT_IN, { key: 'custom_aaaa1111', label: 'Waiting', position: 1, hidden_at: null, built_in: false }],
    })
    expect((await add('WAITING')).status).toBe(409)
    expect(inserted).toHaveLength(0)
  })

  it('brings a hidden stage back rather than adding a second one', async () => {
    const { inserted, updates } = mockDb({
      stages: [...BUILT_IN, { key: 'custom_aaaa1111', label: 'Waiting', position: 1, hidden_at: '2026-11-01T00:00:00Z', built_in: false }],
    })
    const response = await add('waiting')
    expect(response.status).toBe(200)
    expect(inserted).toHaveLength(0)
    expect(updates).toEqual([{ key: 'custom_aaaa1111', patch: { hidden_at: null } }])
  })

  it('turns away an empty name, and a name added by somebody else a moment ago', async () => {
    mockDb()
    expect((await add('   ')).status).toBe(400)
    mockDb({ insertError: { code: '23505' } })
    expect((await add('Waiting')).status).toBe(409)
  })

  it('needs a signed-in staff member', async () => {
    mockDb()
    vi.mocked(getSupabaseAuthClient).mockResolvedValue({
      auth: { getUser: () => Promise.resolve({ data: { user: null }, error: null }) },
    } as never)
    expect((await add('Waiting')).status).toBe(401)
  })
})

describe('PATCH /api/admin/lead-stages/[key]', () => {
  const CUSTOM: StageRow = { key: 'custom_aaaa1111', label: 'Waiting', position: 1, hidden_at: null, built_in: false }

  it('renames a stage staff added', async () => {
    const { updates } = mockDb({ stages: [...BUILT_IN, CUSTOM] })
    const response = await patch('custom_aaaa1111', { label: 'Waiting on accountant' })
    expect(response.status).toBe(200)
    expect(updates).toEqual([{ key: 'custom_aaaa1111', patch: { label: 'Waiting on accountant' } }])
  })

  it('never changes a built-in stage', async () => {
    mockDb({ stages: [...BUILT_IN, CUSTOM] })
    expect((await patch('unresponsive', { label: 'Ghosted' })).status).toBe(400)
    expect((await patch('unresponsive', { hidden: true })).status).toBe(400)
  })

  it('hides a stage nobody is in', async () => {
    const { updates } = mockDb({ stages: [...BUILT_IN, CUSTOM], leadsInStage: 0 })
    const response = await patch('custom_aaaa1111', { hidden: true })
    expect(response.status).toBe(200)
    expect(updates[0].patch.hidden_at).toEqual(expect.any(String))
  })

  it('refuses to hide a stage with leads in it, so none is left on no tab', async () => {
    const { updates } = mockDb({ stages: [...BUILT_IN, CUSTOM], leadsInStage: 2 })
    const response = await patch('custom_aaaa1111', { hidden: true })
    expect(response.status).toBe(409)
    expect((await response.json()).error).toBe('Move its 2 leads to another stage first')
    expect(updates).toHaveLength(0)
  })

  it('says so for a stage that does not exist', async () => {
    mockDb()
    expect((await patch('custom_ffff9999', { label: 'Anything' })).status).toBe(404)
  })
})
