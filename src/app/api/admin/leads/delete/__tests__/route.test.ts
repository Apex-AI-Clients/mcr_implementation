// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase/server', () => ({ getSupabaseServerClient: vi.fn() }))
vi.mock('@/lib/auth/staff', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/staff')>()),
  requireStaffUser: vi.fn(),
}))

import { getSupabaseServerClient } from '@/lib/supabase/server'
import { requireStaffUser } from '@/lib/auth/staff'
import { POST } from '../route'

/**
 * POST /api/admin/leads/delete — deleting a converted lead moves its client
 * file to the Archive. Synthetic data only.
 */

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'

function request(ids: string[]) {
  return new NextRequest('http://localhost/api/admin/leads/delete', {
    method: 'POST',
    body: JSON.stringify({ ids }),
  })
}

function mockDb({
  deleted,
  archiveError = null,
}: {
  deleted: { id: string; converted_client_id: string | null }[]
  archiveError?: { message: string } | null
}) {
  const clientUpdate = vi.fn<(row: Record<string, unknown>) => unknown>()
  const archivedIds = vi.fn<(ids: string[]) => void>()
  const onlyActive = vi.fn<(column: string, value: null) => void>()
  clientUpdate.mockImplementation(() => ({
    in: (_column: string, ids: string[]) => {
      archivedIds(ids)
      return {
        is: (column: string, value: null) => {
          onlyActive(column, value)
          return {
            select: () =>
              Promise.resolve({
                data: archiveError ? null : ids.map((id) => ({ id })),
                error: archiveError,
              }),
          }
        },
      }
    },
  }))
  const tables: Record<string, unknown> = {
    leads: {
      delete: () => ({
        in: () => ({ select: () => Promise.resolve({ data: deleted, error: null }) }),
      }),
    },
    clients: { update: clientUpdate },
  }
  vi.mocked(getSupabaseServerClient).mockReturnValue({
    from: (table: string) => tables[table],
  } as never)
  return { clientUpdate, archivedIds, onlyActive }
}

beforeEach(() => {
  vi.mocked(requireStaffUser).mockResolvedValue({
    id: 'staff-1',
    email: 'test.staff@example.test',
    user_metadata: { full_name: 'Test Staff' },
  } as never)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('POST /api/admin/leads/delete', () => {
  it("archives a deleted lead's client file, with the lead_deleted reason", async () => {
    const { clientUpdate, archivedIds, onlyActive } = mockDb({
      deleted: [
        { id: A, converted_client_id: 'cl_1' },
        { id: B, converted_client_id: null },
      ],
    })
    const response = await POST(request([A, B]))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ deleted: 2, archivedClients: 1 })
    expect(clientUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ archived_reason: 'lead_deleted', archived_by: 'Test' }),
    )
    expect(archivedIds).toHaveBeenCalledWith(['cl_1'])
    // A file already in the Archive keeps the date and reason it was archived with.
    expect(onlyActive).toHaveBeenCalledWith('archived_at', null)
  })

  it('touches no client when no deleted lead was converted', async () => {
    const { clientUpdate } = mockDb({ deleted: [{ id: A, converted_client_id: null }] })
    const response = await POST(request([A]))

    expect(await response.json()).toEqual({ deleted: 1, archivedClients: 0 })
    expect(clientUpdate).not.toHaveBeenCalled()
  })

  it('archives a file once, however many deleted leads point at it', async () => {
    const { archivedIds } = mockDb({
      deleted: [
        { id: A, converted_client_id: 'cl_1' },
        { id: B, converted_client_id: 'cl_1' },
      ],
    })
    await POST(request([A, B]))
    expect(archivedIds).toHaveBeenCalledWith(['cl_1'])
  })

  it('still reports the leads deleted when archiving fails', async () => {
    mockDb({
      deleted: [{ id: A, converted_client_id: 'cl_1' }],
      archiveError: { message: 'boom' },
    })
    const response = await POST(request([A]))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ deleted: 1, archivedClients: 0, archiveFailed: true })
  })
})
