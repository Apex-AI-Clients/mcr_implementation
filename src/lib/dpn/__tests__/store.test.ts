// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { clearNoneIssued, clearedNote, readAndStoreNotice } from '../store'
import { SYNTHETIC, buildNoticePdf } from './fixtures/notice'

/**
 * Reading an uploaded notice into the database, against a mocked Supabase.
 * Also pins what may be logged: ids and outcomes, never a field from the
 * notice. Synthetic notice only.
 */

type Upserted = Record<string, unknown>

function mockSupabase(options: { existingSource?: string; pdf?: Uint8Array | null; noDpn?: { at: string; by: string } }) {
  const upsert = vi.fn<(values: Upserted, opts: unknown) => Promise<{ error: null }>>(() =>
    Promise.resolve({ error: null }),
  )
  const update = vi.fn<(values: Upserted) => { eq: () => Promise<{ error: null }> }>(() => ({
    eq: () => Promise.resolve({ error: null }),
  }))
  const download = vi.fn(() =>
    Promise.resolve(
      options.pdf
        ? { data: new Blob([options.pdf as BlobPart]), error: null }
        : { data: null, error: { message: 'not found' } },
    ),
  )
  const from = vi.fn((table: string) => {
    if (table === 'director_penalty_notices') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({ data: options.existingSource ? { source: options.existingSource } : null }),
          }),
        }),
        upsert,
      }
    }
    return {
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({
              data: options.noDpn
                ? { no_dpn_confirmed_at: options.noDpn.at, no_dpn_confirmed_by: options.noDpn.by }
                : { no_dpn_confirmed_at: null, no_dpn_confirmed_by: null },
            }),
        }),
      }),
      update,
    }
  })
  const supabase = { from, storage: { from: () => ({ download }) } }
  return { supabase: supabase as never, upsert, update, download }
}

const DOC = { id: 'doc-1', client_id: 'client-1', file_path: 'client-1/abc.pdf' }

let logged: string[] = []
beforeEach(() => {
  logged = []
  const capture = (...args: unknown[]) => logged.push(JSON.stringify(args))
  vi.spyOn(console, 'info').mockImplementation(capture)
  vi.spyOn(console, 'error').mockImplementation(capture)
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('readAndStoreNotice', () => {
  it('stores a read notice against its document, without the address', async () => {
    const { supabase, upsert } = mockSupabase({ pdf: await buildNoticePdf() })
    const outcome = await readAndStoreNotice(supabase, DOC)

    expect(outcome).toEqual({ kind: 'stored', status: 'read', manualReason: null })
    const [values, opts] = upsert.mock.calls[0]
    expect(opts).toEqual({ onConflict: 'document_id' })
    expect(values).toMatchObject({
      client_id: 'client-1',
      document_id: 'doc-1',
      source: 'parsed',
      director_name: SYNTHETIC.director,
    })
    expect(JSON.stringify(values)).not.toContain(SYNTHETIC.street)
  })

  it('never logs a field from the notice', async () => {
    const { supabase } = mockSupabase({ pdf: await buildNoticePdf() })
    await readAndStoreNotice(supabase, DOC)
    const everything = logged.join('\n')
    for (const value of Object.values(SYNTHETIC)) expect(everything).not.toContain(value)
  })

  it('never overwrites a manual entry', async () => {
    const { supabase, upsert, download } = mockSupabase({ existingSource: 'manual', pdf: await buildNoticePdf() })
    expect(await readAndStoreNotice(supabase, DOC)).toEqual({ kind: 'kept_manual' })
    expect(download).not.toHaveBeenCalled()
    expect(upsert).not.toHaveBeenCalled()
  })

  it('stores a file that is not a PDF as needing manual entry', async () => {
    const { supabase, upsert } = mockSupabase({ pdf: new TextEncoder().encode('not a pdf') })
    expect(await readAndStoreNotice(supabase, DOC)).toEqual({
      kind: 'stored',
      status: 'needs_manual',
      manualReason: 'pdf_unreadable',
    })
    expect(upsert.mock.calls[0][0]).toMatchObject({ status: 'needs_manual', manual_reason: 'pdf_unreadable' })
  })

  it('reports a failed download without storing anything', async () => {
    const { supabase, upsert } = mockSupabase({ pdf: null })
    expect(await readAndStoreNotice(supabase, DOC)).toEqual({ kind: 'failed' })
    expect(upsert).not.toHaveBeenCalled()
  })
})

describe('clearNoneIssued', () => {
  it('clears the tick and leaves a note saying who had ticked it', async () => {
    const { supabase, update } = mockSupabase({ noDpn: { at: '2026-10-10T01:00:00Z', by: 'Sam' } })
    await clearNoneIssued(supabase, 'client-1')
    const values = update.mock.calls[0][0]
    expect(values).toMatchObject({ no_dpn_confirmed_at: null, no_dpn_confirmed_by: null })
    expect(values.no_dpn_cleared_note).toMatch(/ticked by Sam on 10 Oct 2026/)
  })

  it('does nothing when the tick is not set', async () => {
    const { supabase, update } = mockSupabase({})
    await clearNoneIssued(supabase, 'client-1')
    expect(update).not.toHaveBeenCalled()
  })
})

describe('clearedNote', () => {
  it('dates both events in Sydney time', () => {
    expect(clearedNote(new Date('2026-10-16T15:00:00Z'), 'Sam', '2026-10-09T14:30:00Z')).toBe(
      '"No director penalty notice has been issued" was cleared automatically on 17 Oct 2026, ' +
        'when a director penalty notice was uploaded. It had been ticked by Sam on 10 Oct 2026.',
    )
  })
})
