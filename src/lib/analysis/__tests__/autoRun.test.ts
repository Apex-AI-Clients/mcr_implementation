// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/dpn/store', () => ({ readAndStoreNotice: vi.fn() }))
vi.mock('../lodgementStore', () => ({ analyseAndStoreLodgement: vi.fn(), findActivityStatementCsv: vi.fn() }))
vi.mock('@/lib/financials/comparisonJob', () => ({
  EXTRACTION_PHASE_BUDGET_MS: 640_000,
  extractAllFinancials: vi.fn(),
  buildAndPersistComparison: vi.fn(),
}))
vi.mock('@/lib/financials/jobLiveness', () => ({ findLiveComparisonJob: vi.fn() }))
vi.mock('@/lib/printed/store', () => ({ READER_VERSION: 'v1', readAndStore: vi.fn() }))

import { readAndStoreNotice } from '@/lib/dpn/store'
import { analyseAndStoreLodgement, findActivityStatementCsv } from '../lodgementStore'
import { buildAndPersistComparison, extractAllFinancials } from '@/lib/financials/comparisonJob'
import { findLiveComparisonJob } from '@/lib/financials/jobLiveness'
import { readAndStore } from '@/lib/printed/store'
import {
  categoryTriggersAnalysis,
  decideWork,
  newAttempted,
  runAutoAnalysis,
  scheduleClientAnalysis,
  type AnalysisSnapshot,
} from '../autoRun'
import { isActivityStatementCsv } from '../parseActivityStatement'

/**
 * Automatic runs on upload and delete. Synthetic ids and CSVs; the steps
 * themselves are mocked, so these pin what runs, when, and that no AI
 * summary is asked for.
 */

function snapshot(over: Partial<AnalysisSnapshot> = {}): AnalysisSnapshot {
  return {
    dpnDocumentIds: [],
    readNoticeDocumentIds: new Set(),
    activityStatementDocumentId: null,
    analysedDocumentIds: new Set(),
    financialDocuments: [],
    extractedAt: new Map(),
    comparison: { exists: false, staleSince: null },
    ...over,
  }
}

describe('decideWork', () => {
  it('has nothing to do for an empty file', () => {
    expect(decideWork(snapshot())).toEqual({ dpn: [], lodgement: false, extract: [], compare: false })
  })

  it('reads notices not yet read, and analyses an export not yet analysed', () => {
    const work = decideWork(
      snapshot({
        dpnDocumentIds: ['dpn-1', 'dpn-2'],
        readNoticeDocumentIds: new Set(['dpn-1']),
        activityStatementDocumentId: 'csv-2',
        analysedDocumentIds: new Set(['csv-1']),
      }),
    )
    expect(work.dpn).toEqual(['dpn-2'])
    expect(work.lodgement).toBe(true)
  })

  it('extracts only new files and files overridden since their last read, then compares', () => {
    const work = decideWork(
      snapshot({
        financialDocuments: [
          { id: 'old', overrideAt: null },
          { id: 'new', overrideAt: null },
          { id: 'changed', overrideAt: '2026-10-10T00:00:00Z' },
          { id: 'set-before', overrideAt: '2026-09-01T00:00:00Z' },
        ],
        extractedAt: new Map([
          ['old', '2026-10-01T00:00:00Z'],
          ['changed', '2026-10-01T00:00:00Z'],
          ['set-before', '2026-10-01T00:00:00Z'],
        ]),
        comparison: { exists: true, staleSince: null },
      }),
    )
    expect(work.extract).toEqual(['new', 'changed'])
    expect(work.compare).toBe(true)
  })

  it('rebuilds a stale comparison without extracting anything (a file was deleted)', () => {
    const work = decideWork(
      snapshot({
        financialDocuments: [{ id: 'a', overrideAt: null }],
        extractedAt: new Map([['a', '2026-10-01T00:00:00Z']]),
        comparison: { exists: true, staleSince: '2026-10-17T00:00:00Z' },
      }),
    )
    expect(work).toMatchObject({ extract: [], compare: true })
  })

  it('never retries what this run already tried', () => {
    const attempted = newAttempted()
    attempted.dpn.add('dpn-1')
    attempted.extract.add('bad.pdf')
    attempted.lodgement = true
    attempted.compare = true
    const work = decideWork(
      snapshot({
        dpnDocumentIds: ['dpn-1'],
        activityStatementDocumentId: 'csv-1',
        financialDocuments: [{ id: 'bad.pdf', overrideAt: null }],
      }),
      attempted,
    )
    expect(work).toEqual({ dpn: [], lodgement: false, extract: [], compare: false })
  })
})

describe('isActivityStatementCsv', () => {
  const header = 'Processed date,Effective date,Description,Debit (DR),Credit (CR),Balance'

  it('recognises an export by its label and header, whatever the file is called', () => {
    expect(isActivityStatementCsv(`"Activity statement 002"\r\n"EXAMPLE TRADING PTY LTD"\r\n${header}\r\n`)).toBe(true)
  })

  it('does not take an income tax or super account export for one', () => {
    expect(isActivityStatementCsv(`"Income tax 551"\n"EXAMPLE TRADING PTY LTD"\n${header}\n`)).toBe(false)
    expect(isActivityStatementCsv(`"Superannuation guarantee 001"\n"EXAMPLE"\n${header}\n`)).toBe(false)
  })

  it('refuses a CSV with another header, or nothing at all', () => {
    expect(isActivityStatementCsv(`"Activity statement 002"\n"EXAMPLE"\nDate,Amount\n`)).toBe(false)
    expect(isActivityStatementCsv('')).toBe(false)
  })
})

describe('categoryTriggersAnalysis', () => {
  it.each([
    ['financial_statements', true],
    ['historical_financials', true],
    ['integrated_client_account', true],
    ['director_penalty_notices', true],
    ['trust_deed', false],
    ['company_licences', false],
  ])('%s -> %s', (category, expected) => {
    expect(categoryTriggersAnalysis(category)).toBe(expected)
  })
})

// ─── Running ──────────────────────────────────────────────────────────────────

/** A database answering the snapshot queries from `state`, which tests mutate. */
function mockDb(state: {
  docs: { id: string; doc_category: string; fs_override_at: string | null }[]
  notices: string[]
  analyses: string[]
  extractions: { document_id: string; extracted_at: string }[]
  comparison: { stale_since: string | null } | null
}) {
  const jobUpdates: Record<string, unknown>[] = []
  const inserted: unknown[] = []
  const table = (name: string) => {
    const chain: Record<string, unknown> = {}
    let onlyIds: string[] | null = null
    const result = () => {
      switch (name) {
        case 'documents':
          return {
            data: state.docs
              .filter((d) => !onlyIds || onlyIds.includes(d.id))
              .map((d) => ({ ...d, client_id: 'client-1', file_path: `client-1/${d.id}` })),
          }
        case 'director_penalty_notices':
          return { data: state.notices.map((document_id) => ({ document_id })) }
        case 'lodgement_analyses':
          return { data: state.analyses.map((document_id) => ({ document_id })) }
        case 'financial_document_extractions':
          return { data: state.extractions }
        case 'printed_reads':
          return { data: state.extractions.map((e) => ({ document_id: e.document_id, reader_version: 'v1', read_at: e.extracted_at })) }
        default:
          return { data: null }
      }
    }
    for (const m of ['select', 'eq']) chain[m] = () => chain
    chain.in = (column: string, values: string[]) => {
      if (column === 'id') onlyIds = values
      return chain
    }
    chain.maybeSingle = async () => ({ data: name === 'financial_comparisons' ? state.comparison : null })
    chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve)
    chain.update = (values: Record<string, unknown>) => {
      if (name === 'financial_comparison_jobs') jobUpdates.push(values)
      return { eq: async () => ({ error: null }) }
    }
    chain.insert = (values: unknown) => {
      inserted.push(values)
      return { select: () => ({ single: async () => ({ data: { id: 'job-1' }, error: null }) }) }
    }
    return chain
  }
  return { supabase: { from: table } as never, jobUpdates, inserted }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

describe('runAutoAnalysis', () => {
  it('runs each step once, with no AI summary, and marks the job done', async () => {
    const state = {
      docs: [
        { id: 'dpn-1', doc_category: 'director_penalty_notices', fs_override_at: null },
        { id: 'csv-1', doc_category: 'integrated_client_account', fs_override_at: null },
        { id: 'fs-1', doc_category: 'financial_statements', fs_override_at: null },
      ],
      notices: [] as string[],
      analyses: [] as string[],
      extractions: [] as { document_id: string; extracted_at: string }[],
      comparison: null as { stale_since: string | null } | null,
    }
    const { supabase, jobUpdates } = mockDb(state)
    vi.mocked(findActivityStatementCsv).mockResolvedValue({
      doc: { id: 'csv-1', file_path: 'p', original_filename: 'renamed.csv' },
      text: '',
    })
    vi.mocked(readAndStoreNotice).mockImplementation(async () => {
      state.notices.push('dpn-1')
      return { kind: 'stored', status: 'read', manualReason: null }
    })
    vi.mocked(analyseAndStoreLodgement).mockImplementation(async () => {
      state.analyses.push('csv-1')
      return { ok: true } as never
    })
    vi.mocked(readAndStore).mockImplementation(async (_s, _c, doc) => {
      state.extractions.push({ document_id: doc.id, extracted_at: '2026-10-17T00:00:00Z' })
      return { documentId: doc.id, readAt: '2026-10-17T00:00:00Z', read: { status: 'read', pageCount: 3, statements: [], issues: [] } }
    })

    const summary = await runAutoAnalysis({ jobId: 'job-1', clientId: 'client-1', supabase })

    expect(readAndStoreNotice).toHaveBeenCalledTimes(1)
    expect(analyseAndStoreLodgement).toHaveBeenCalledWith(supabase, 'client-1', expect.anything(), { aiSummary: false })
    // Read as printed, by our own code: the AI reader and the stored comparison are not used.
    expect(readAndStore).toHaveBeenCalledTimes(1)
    expect(vi.mocked(readAndStore).mock.calls[0][2]).toMatchObject({ id: 'fs-1' })
    expect(extractAllFinancials).not.toHaveBeenCalled()
    expect(buildAndPersistComparison).not.toHaveBeenCalled()
    expect(summary).toMatchObject({ dpnRead: 1, lodgementAnalysed: true, extracted: 1 })
    expect(jobUpdates.at(-1)).toMatchObject({ status: 'done' })
  })

  it('does not loop on a file that cannot be read, and says why', async () => {
    const state = {
      docs: [{ id: 'bad', doc_category: 'financial_statements', fs_override_at: null }],
      notices: [],
      analyses: [],
      extractions: [],
      comparison: null,
    }
    const { supabase } = mockDb(state)
    vi.mocked(findActivityStatementCsv).mockResolvedValue(null)
    vi.mocked(readAndStore).mockResolvedValue({
      documentId: 'bad',
      readAt: '2026-10-17T00:00:00Z',
      read: { status: 'no_text_layer', pageCount: 2, statements: [], issues: [{ kind: 'no_text_layer', page: null, text: null, message: 'This PDF has no readable text.' }] },
    })

    const summary = await runAutoAnalysis({ jobId: 'job-1', clientId: 'client-1', supabase })
    // Not kept (the mock stores nothing), yet tried once per run.
    expect(readAndStore).toHaveBeenCalledTimes(1)
    expect(summary.extracted).toBe(0)
    expect(summary.notes).toEqual([expect.stringContaining('This PDF has no readable text.')])
  })
})

describe('scheduleClientAnalysis', () => {
  const empty = { docs: [], notices: [], analyses: [], extractions: [], comparison: null }

  it('leaves the work to a run already going', async () => {
    vi.mocked(findLiveComparisonJob).mockResolvedValue({ id: 'job-running', status: 'processing', created_at: '', mode: 'full' })
    const schedule = vi.fn()
    const { supabase, inserted } = mockDb(empty)
    expect(await scheduleClientAnalysis(supabase, 'client-1', schedule)).toEqual({ jobId: 'job-running', started: false })
    expect(inserted).toHaveLength(0)
    expect(schedule).not.toHaveBeenCalled()
  })

  it('creates a job and schedules the run after the response', async () => {
    vi.mocked(findLiveComparisonJob).mockResolvedValue(null)
    vi.mocked(findActivityStatementCsv).mockResolvedValue(null)
    const schedule = vi.fn()
    const { supabase, inserted } = mockDb(empty)
    expect(await scheduleClientAnalysis(supabase, 'client-1', schedule)).toEqual({ jobId: 'job-1', started: true })
    expect(inserted).toEqual([{ client_id: 'client-1', status: 'pending', mode: 'full' }])
    expect(schedule).toHaveBeenCalledTimes(1)
  })
})
