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
import { POST as DELETE_STAGE } from '../[key]/delete/route'

/**
 * Stages staff add by typing (lead_stages, migration 0042): adding, renaming
 * and deleting one, and the names they can't take. Synthetic data only.
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
function mockDb({
  stages = BUILT_IN,
  leadsInStage = 0,
  insertError = null as { code: string } | null,
  deleteError = null as { code: string } | null,
} = {}) {
  const rows = stages.map((row) => ({ ...row }))
  const inserted: Record<string, unknown>[] = []
  const updates: { key: string; patch: Record<string, unknown> }[] = []
  const deleted: string[] = []
  const leadMoves: { from: string; patch: Record<string, unknown> }[] = []
  const activities: Record<string, unknown>[] = []
  const leadIds = Array.from({ length: leadsInStage }, (_, i) => ({ id: `lead-${i + 1}` }))

  const single = (row: StageRow | undefined) => ({ single: () => Promise.resolve({ data: row ?? null, error: null }) })

  const lead_stages = {
    select: () => ({
      // POST reads every row; PATCH reads one by key.
      then: (resolve: (value: unknown) => void) => resolve({ data: rows, error: null }),
      eq: (_column: string, key: string) => {
        const found = () => rows.find((row) => row.key === key)
        return {
          maybeSingle: () => Promise.resolve({ data: found() ?? null, error: null }),
          is: () => ({
            maybeSingle: () => {
              const row = found()
              return Promise.resolve({ data: row && !row.hidden_at ? row : null, error: null })
            },
          }),
        }
      },
    }),
    delete: () => ({
      eq: (_column: string, key: string) => {
        if (!deleteError) deleted.push(key)
        return Promise.resolve({ error: deleteError })
      },
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
    update: (patch: Record<string, unknown>) => ({
      eq: (_column: string, from: string) => ({
        select: () => {
          leadMoves.push({ from, patch })
          return Promise.resolve({ data: leadIds, error: null })
        },
      }),
    }),
  }
  const lead_activities = {
    insert: (batch: Record<string, unknown>[]) => {
      activities.push(...batch)
      return Promise.resolve({ error: null })
    },
  }
  vi.mocked(getSupabaseServerClient).mockReturnValue({
    from: (table: string) => ({ lead_stages, leads, lead_activities })[table],
  } as never)
  return { inserted, updates, deleted, leadMoves, activities }
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
  })

  it('says so for a stage that does not exist', async () => {
    mockDb()
    expect((await patch('custom_ffff9999', { label: 'Anything' })).status).toBe(404)
  })
})

describe('POST /api/admin/lead-stages/[key]/delete', () => {
  const CUSTOM: StageRow = { key: 'custom_aaaa1111', label: 'Waiting', position: 1, hidden_at: null, built_in: false }
  const OTHER: StageRow = { key: 'custom_bbbb2222', label: 'Parked', position: 2, hidden_at: null, built_in: false }
  const remove = (key: string, body: unknown = {}) =>
    DELETE_STAGE(request('POST', `http://localhost/api/admin/lead-stages/${key}/delete`, body), {
      params: Promise.resolve({ key }),
    })

  it('deletes a stage nobody is in', async () => {
    const { deleted, leadMoves } = mockDb({ stages: [...BUILT_IN, CUSTOM] })
    const response = await remove('custom_aaaa1111')
    expect(response.status).toBe(200)
    expect(deleted).toEqual(['custom_aaaa1111'])
    expect(leadMoves).toHaveLength(0)
  })

  it('asks where its leads go, rather than leaving them on no stage', async () => {
    const { deleted } = mockDb({ stages: [...BUILT_IN, CUSTOM], leadsInStage: 2 })
    const response = await remove('custom_aaaa1111')
    expect(response.status).toBe(409)
    expect((await response.json()).error).toBe('Choose a stage for its 2 leads')
    expect(deleted).toHaveLength(0)
  })

  it('moves its leads first, each with a stage-change entry, then deletes it', async () => {
    const { deleted, leadMoves, activities } = mockDb({ stages: [...BUILT_IN, CUSTOM], leadsInStage: 2 })
    const response = await remove('custom_aaaa1111', { moveTo: 'unresponsive' })
    expect(response.status).toBe(200)
    expect((await response.json()).moved).toBe(2)
    expect(leadMoves).toEqual([
      { from: 'custom_aaaa1111', patch: { stage: 'unresponsive', stage_since: expect.any(String) } },
    ])
    expect(activities).toEqual([
      { lead_id: 'lead-1', type: 'stage_change', body: 'Stage changed from Waiting to Unresponsive.', author: 'staff' },
      { lead_id: 'lead-2', type: 'stage_change', body: 'Stage changed from Waiting to Unresponsive.', author: 'staff' },
    ])
    expect(deleted).toEqual(['custom_aaaa1111'])
  })

  it('can move them to another stage staff added, by its name', async () => {
    const { activities } = mockDb({ stages: [...BUILT_IN, CUSTOM, OTHER], leadsInStage: 1 })
    expect((await remove('custom_aaaa1111', { moveTo: 'custom_bbbb2222' })).status).toBe(200)
    expect(activities[0].body).toBe('Stage changed from Waiting to Parked.')
  })

  it('will not move them to Client, to itself, or to a stage that is gone', async () => {
    const { deleted } = mockDb({ stages: [...BUILT_IN, CUSTOM], leadsInStage: 1 })
    expect((await remove('custom_aaaa1111', { moveTo: 'client' })).status).toBe(400)
    expect((await remove('custom_aaaa1111', { moveTo: 'custom_aaaa1111' })).status).toBe(400)
    expect((await remove('custom_aaaa1111', { moveTo: 'custom_ffff9999' })).status).toBe(400)
    expect(deleted).toHaveLength(0)
  })

  it('never deletes a built-in stage', async () => {
    mockDb()
    expect((await remove('unresponsive')).status).toBe(400)
  })

  it('says so when a lead was moved in at the last moment', async () => {
    mockDb({ stages: [...BUILT_IN, CUSTOM], deleteError: { code: '23503' } })
    expect((await remove('custom_aaaa1111')).status).toBe(409)
  })
})
