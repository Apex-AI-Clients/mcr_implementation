// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ getSupabaseServerClient: vi.fn() }))

import { getSupabaseServerClient } from '@/lib/supabase/server'
import { getClientListPage } from '@/lib/clients/listing'
import { getCvlListPage } from '../listing'

/**
 * Which list a file is on (migration 0039): the SBR client list leaves CVL
 * files out, the CVL list and "Moved to CVL" read cvl_cases. Synthetic rows.
 */

/** A query chain that records every filter, and answers with `rows`. */
function recordingDb(rows: unknown[] = []) {
  const calls: { table: string; method: string; args: unknown[] }[] = []
  vi.mocked(getSupabaseServerClient).mockReturnValue({
    from: (table: string) => {
      const chain: Record<string, unknown> = {}
      for (const method of ['select', 'is', 'not', 'eq', 'or', 'order', 'in']) {
        chain[method] = (...args: unknown[]) => {
          calls.push({ table, method, args })
          return chain
        }
      }
      chain.range = (...args: unknown[]) => {
        calls.push({ table, method: 'range', args })
        return Promise.resolve({ data: rows, count: rows.length, error: null })
      }
      return chain
    },
  } as never)
  return calls
}

const filters = (calls: ReturnType<typeof recordingDb>, table: string) =>
  calls.filter((c) => c.table === table && ['is', 'not', 'eq'].includes(c.method)).map((c) => [c.method, ...c.args])

describe('the SBR client list', () => {
  it('lists SBR files only, not archived', async () => {
    const calls = recordingDb()
    await getClientListPage({ archived: false })
    expect(filters(calls, 'clients')).toEqual([
      ['is', 'archived_at', null],
      ['eq', 'workflow', 'sbr'],
    ])
  })

  it('keeps every archived file in the Archive, whichever workspace it was in', async () => {
    const calls = recordingDb()
    await getClientListPage({ archived: true })
    expect(filters(calls, 'clients')).toEqual([['not', 'archived_at', 'is', null]])
  })
})

describe('the Archive', () => {
  it('filters archived files by workflow, and marks each row with it', async () => {
    const calls = recordingDb([{ id: 'cl_1', name: 'Sample Trading Pty Ltd', email: 'a@example.test', status: 'in_progress', workflow: 'cvl', archived_at: '2026-10-01T00:00:00Z' }])
    const page = await getClientListPage({ archived: true, workflow: 'cvl' })
    expect(filters(calls, 'clients')).toEqual([
      ['not', 'archived_at', 'is', null],
      ['eq', 'workflow', 'cvl'],
    ])
    expect(page.clients[0].workflow).toBe('cvl')
  })
})

describe('the CVL list', () => {
  const ROW = {
    id: 'case-1',
    client_id: 'cl_1',
    origin: 'sbr_client',
    status: 'printed',
    forms_prepared_at: '2026-10-25T00:00:00.000Z',
    printed_at: '2026-10-26T00:00:00.000Z',
    sbr_archived_at: '2026-10-20T00:00:00.000Z',
    sbr_archived_by: 'Gabby',
    created_at: '2026-10-20T00:00:00.000Z',
    clients: { name: 'Sample Trading Pty Ltd', email: 'accounts@example.test', workflow: 'sbr', archived_at: null },
  }

  it('lists the files in CVL (case not removed), newest first, whatever their SBR side, saying which are also in SBR', async () => {
    const calls = recordingDb([
      ROW,
      { ...ROW, id: 'case-2', client_id: 'cl_2', origin: 'lead', clients: { ...ROW.clients, workflow: 'cvl' } },
      { ...ROW, id: 'case-3', client_id: 'cl_3', clients: { ...ROW.clients, archived_at: '2026-11-01T00:00:00Z' } },
    ])
    const page = await getCvlListPage({})
    // In CVL is the case's own state: a client archived from SBR stays on this list.
    expect(filters(calls, 'cvl_cases')).toEqual([['is', 'removed_at', null]])
    expect(calls.find((c) => c.method === 'order')?.args[0]).toBe('created_at')
    expect(page.rows.map((r) => [r.clientId, r.inSbr])).toEqual([
      ['cl_1', true],
      ['cl_2', false],
      ['cl_3', false],
    ])
    expect(page.rows[0]).toEqual(expect.objectContaining({ name: 'Sample Trading Pty Ltd', status: 'printed', origin: 'sbr_client' }))
  })
})
