// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase/server', () => ({
  getSupabaseServerClient: vi.fn(),
  getSupabaseAuthClient: vi.fn(),
}))
vi.mock('@/lib/auth/staff', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/staff')>()),
  requireStaffUser: vi.fn(),
}))

import { getSupabaseAuthClient, getSupabaseServerClient } from '@/lib/supabase/server'
import { requireStaffUser } from '@/lib/auth/staff'
import { POST as archive } from '../archive/route'
import { POST as restore } from '../restore/route'
import { DELETE } from '../route'

/**
 * The Archive's three routes: archive (from the client page), restore, and the
 * permanent delete — which is now only allowed for an archived file.
 * Synthetic data only.
 */

const PARAMS = { params: Promise.resolve({ id: 'cl_1' }) }

function req(method: string) {
  return new NextRequest('http://localhost/api/admin/clients/cl_1', { method })
}

function mockDb(
  client: { id: string; archived_at: string | null; auth_user_id?: string | null; name?: string; archived_by?: string | null; archived_reason?: string | null } | null,
  convertedLeads: { id: string; activities: { type: string; body: string; created_at: string }[] }[] = [],
) {
  const leadUpdate = vi.fn<(row: Record<string, unknown>) => unknown>(() => ({ eq: () => Promise.resolve({ error: null }) }))
  const activityInsert = vi.fn(() => Promise.resolve({ error: null }))
  const deletionInsert = vi.fn<(row: Record<string, unknown>) => Promise<{ error: { message: string } | null }>>(() => Promise.resolve({ error: null }))
  const update = vi.fn<(row: Record<string, unknown>) => unknown>(() => ({
    eq: () => Promise.resolve({ error: null }),
  }))
  const remove = vi.fn(() => ({ eq: () => Promise.resolve({ error: null }) }))
  const storageRemove = vi.fn(() => Promise.resolve({ error: null }))
  const deleteUser = vi.fn(() => Promise.resolve({ error: null }))
  const tables: Record<string, unknown> = {
    clients: {
      select: () => ({
        eq: () => ({ maybeSingle: () => Promise.resolve({ data: client, error: null }) }),
      }),
      update,
      delete: remove,
    },
    documents: {
      select: () => ({ eq: () => Promise.resolve({ data: [{ file_path: 'cl_1/a.pdf' }] }) }),
    },
    client_deletions: { insert: deletionInsert },
    leads: {
      select: () => ({ eq: () => Promise.resolve({ data: convertedLeads.map(({ id }) => ({ id })), error: null }) }),
      update: leadUpdate,
    },
    lead_activities: {
      select: () => ({
        eq: (_: string, leadId: string) => ({
          eq: () => Promise.resolve({ data: convertedLeads.find((l) => l.id === leadId)?.activities ?? [], error: null }),
        }),
      }),
      insert: activityInsert,
    },
  }
  vi.mocked(getSupabaseServerClient).mockReturnValue({
    from: (table: string) => tables[table],
    storage: { from: () => ({ remove: storageRemove }) },
    auth: { admin: { deleteUser } },
  } as never)
  return { update, remove, storageRemove, deleteUser, leadUpdate, activityInsert, deletionInsert }
}

beforeEach(() => {
  vi.mocked(requireStaffUser).mockResolvedValue({
    id: 'staff-1',
    email: 'test.staff@example.test',
    user_metadata: { full_name: 'Test Staff' },
  } as never)
  vi.mocked(getSupabaseAuthClient).mockResolvedValue({
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'staff-1' } }, error: null }) },
  } as never)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('POST archive', () => {
  it('archives an active file, recording who and why, and deletes nothing', async () => {
    const { update, remove } = mockDb({ id: 'cl_1', archived_at: null })
    const response = await archive(req('POST'), PARAMS)

    expect(response.status).toBe(200)
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ archived_reason: 'client_deleted', archived_by: 'Test' }),
    )
    expect(update.mock.calls[0][0].archived_at).toEqual(expect.any(String))
    expect(remove).not.toHaveBeenCalled()
  })

  it('leaves an already-archived file as it was', async () => {
    const { update } = mockDb({ id: 'cl_1', archived_at: '2026-09-30T00:00:00.000Z' })
    const response = await archive(req('POST'), PARAMS)

    expect(response.status).toBe(200)
    expect(update).not.toHaveBeenCalled()
  })

  it('answers 404 for a file that is not there, and 401 without a session', async () => {
    mockDb(null)
    expect((await archive(req('POST'), PARAMS)).status).toBe(404)

    vi.mocked(requireStaffUser).mockResolvedValue(null as never)
    expect((await archive(req('POST'), PARAMS)).status).toBe(401)
  })
})

describe('POST restore', () => {
  it('clears the archive columns', async () => {
    const { update } = mockDb({ id: 'cl_1', archived_at: '2026-09-30T00:00:00.000Z' })
    const response = await restore(req('POST'), PARAMS)

    expect(response.status).toBe(200)
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ archived_at: null, archived_by: null, archived_reason: null }),
    )
  })

  it('refuses a file that is not archived', async () => {
    const { update } = mockDb({ id: 'cl_1', archived_at: null })
    const response = await restore(req('POST'), PARAMS)

    expect(response.status).toBe(409)
    expect(update).not.toHaveBeenCalled()
  })
})

describe('DELETE — permanent, from the Archive only', () => {
  it('refuses a file still on the client list, and destroys nothing', async () => {
    const { remove, storageRemove, deleteUser } = mockDb({
      id: 'cl_1',
      archived_at: null,
      auth_user_id: 'auth-1',
    })
    const response = await DELETE(req('DELETE'), PARAMS)

    expect(response.status).toBe(409)
    expect((await response.json()).error).toMatch(/Archive this client/)
    expect(remove).not.toHaveBeenCalled()
    expect(storageRemove).not.toHaveBeenCalled()
    expect(deleteUser).not.toHaveBeenCalled()
  })

  it('deletes an archived file with its storage objects', async () => {
    const { remove, storageRemove } = mockDb({
      id: 'cl_1',
      archived_at: '2026-09-30T00:00:00.000Z',
      auth_user_id: null,
    })
    const response = await DELETE(req('DELETE'), PARAMS)

    expect(response.status).toBe(200)
    expect(storageRemove).toHaveBeenCalledWith(['cl_1/a.pdf'])
    expect(remove).toHaveBeenCalled()
  })

  it('records who deleted which client, and its archive stamp, before anything is deleted', async () => {
    const { remove, storageRemove, deletionInsert } = mockDb({
      id: 'cl_1',
      name: 'Example Pty Ltd',
      archived_at: '2026-09-30T00:00:00.000Z',
      archived_by: 'Test Staff',
      archived_reason: 'client_deleted',
      auth_user_id: null,
    })
    expect((await DELETE(req('DELETE'), PARAMS)).status).toBe(200)
    expect(deletionInsert).toHaveBeenCalledWith(
      expect.objectContaining({ client_id: 'cl_1', client_name: 'Example Pty Ltd', archived_reason: 'client_deleted', archived_by: 'Test Staff', deleted_by: expect.any(String) }),
    )
    expect(deletionInsert.mock.invocationCallOrder[0]).toBeLessThan(storageRemove.mock.invocationCallOrder[0])
    expect(remove).toHaveBeenCalled()
  })

  it('deletes nothing when the record cannot be written', async () => {
    const { remove, storageRemove, deletionInsert } = mockDb({ id: 'cl_1', name: 'Example Pty Ltd', archived_at: '2026-09-30T00:00:00.000Z', auth_user_id: null })
    deletionInsert.mockResolvedValueOnce({ error: { message: 'relation does not exist' } })
    expect((await DELETE(req('DELETE'), PARAMS)).status).toBe(500)
    expect(storageRemove).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
  })

  it('sets the converted lead back to its stage before conversion, with a note, before the file goes', async () => {
    const { remove, leadUpdate, activityInsert } = mockDb({ id: 'cl_1', archived_at: '2026-09-30T00:00:00.000Z', auth_user_id: null }, [
      {
        id: 'lead-1',
        activities: [{ type: 'stage_change', body: 'Converted to a client file in the restructuring workspace. Stage before: Prospect.', created_at: '2026-09-01T00:00:00Z' }],
      },
    ])
    const response = await DELETE(req('DELETE'), PARAMS)

    expect(response.status).toBe(200)
    expect(leadUpdate).toHaveBeenCalledWith(expect.objectContaining({ stage: 'prospect', converted_client_id: null }))
    expect(activityInsert).toHaveBeenCalledWith(
      expect.objectContaining({ lead_id: 'lead-1', type: 'stage_change', body: expect.stringMatching(/^Client file deleted on .+\. Stage set back to Prospect\.$/) }),
    )
    expect(leadUpdate.mock.invocationCallOrder[0]).toBeLessThan(remove.mock.invocationCallOrder[0])
  })
})
