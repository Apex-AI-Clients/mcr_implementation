// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { loadStoredReads, READER_VERSION } from '../store'

/** Which stored reads are used: a scanned file, once read, is kept across reader updates (until Refresh). Synthetic. */

function supabaseWith(rows: Record<string, unknown>[]) {
  return { from: () => ({ select: () => ({ eq: async () => ({ data: rows, error: null }) }) }) } as never
}
const row = (id: string, version: string, scan: unknown = null) => ({
  document_id: id,
  reader_version: version,
  status: 'read',
  page_count: 25,
  statements: [],
  issues: [],
  read_at: '2026-11-06T00:00:00Z',
  scan,
})
const scanDone = { state: 'done', pages: [{ page: 1, scanned: true, role: 'statement' }], singleReading: false, model: 'anthropic/claude-sonnet-5.5', message: null }

describe('loadStoredReads', () => {
  it('keeps a finished scan read by an older reader, but reads a text-layer file again after a reader update', async () => {
    const reads = await loadStoredReads(
      supabaseWith([
        row('current', READER_VERSION),
        row('old-digital', '2026-01-01.1'),
        row('old-scan', '2026-01-01.1', scanDone),
        row('old-scan-pending', '2026-01-01.1', { ...scanDone, state: 'pending' }),
      ]),
      'c1',
    )
    expect([...reads.keys()].sort()).toEqual(['current', 'old-scan'])
  })
})
