// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/ai/lodgementSummary', () => ({ generateLodgementAiSummary: vi.fn() }))
vi.mock('@/lib/ai/financialsComparisonSummary', () => ({ generateFinancialsComparisonSummary: vi.fn() }))

import { generateLodgementAiSummary } from '@/lib/ai/lodgementSummary'
import { generateFinancialsComparisonSummary } from '@/lib/ai/financialsComparisonSummary'
import { analyseAndStoreLodgement, ensureLodgementSummary, findActivityStatementCsv } from '../lodgementStore'
import { ensureComparisonSummary } from '@/lib/financials/comparisonSummary'

/**
 * The lodgement analysis store and the on-demand summaries, against a mocked
 * Supabase. Synthetic CSVs and names only.
 */

const HEADER = 'Processed date,Effective date,Description,Debit (DR),Credit (CR),Balance'
const csv = (label: string, rows = '') => `"${label}"\n"EXAMPLE TRADING PTY LTD"\n${HEADER}\n${rows}`
const LATE_ROW =
  `26 Feb 2026,28 Oct 2025,"'Original Activity Statement for the period ending 30 Jun 25",$1000.00,,$1000.00 DR\n`

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('findActivityStatementCsv', () => {
  function mockFiles(files: { id: string; name: string; text: string }[]) {
    const download = vi.fn(async (path: string) => ({
      data: new Blob([files.find((f) => f.id === path)!.text]),
      error: null,
    }))
    const chain: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'order']) chain[m] = () => chain
    chain.limit = async () => ({
      data: files.map((f) => ({ id: f.id, file_path: f.id, original_filename: f.name, file_type: 'text/csv' })),
    })
    return { supabase: { from: () => chain, storage: { from: () => ({ download }) } } as never, download }
  }

  it('finds the newest file whose content is an activity statement, whatever its name', async () => {
    const { supabase } = mockFiles([
      { id: 'income-tax', name: 'export.csv', text: csv('Income tax 551') },
      { id: 'renamed', name: 'ato download (3).csv', text: csv('Activity statement 002') },
      { id: 'older', name: 'Activity statement 002.csv', text: csv('Activity statement 002') },
    ])
    const found = await findActivityStatementCsv(supabase, 'client-1')
    expect(found?.doc.id).toBe('renamed')
  })

  it('finds nothing when no file is one', async () => {
    const { supabase } = mockFiles([{ id: 'a', name: 'Activity statement.csv', text: csv('Income tax 551') }])
    expect(await findActivityStatementCsv(supabase, 'client-1')).toBeNull()
  })
})

function mockUpsert() {
  const upsert = vi.fn((values: Record<string, unknown>) => ({
    select: () => ({ single: async () => ({ data: { id: 'la-1', ...values }, error: null }) }),
  }))
  return { supabase: { from: () => ({ upsert }) } as never, upsert }
}

const FILE = { doc: { id: 'doc-1', file_path: 'p', original_filename: 'renamed.csv' }, text: csv('Activity statement 002', LATE_ROW) }

describe('analyseAndStoreLodgement', () => {
  it('stores the figures with no summary, and never calls the AI, in an automatic run', async () => {
    const { supabase, upsert } = mockUpsert()
    const outcome = await analyseAndStoreLodgement(supabase, 'client-1', FILE, { aiSummary: false })
    expect(outcome.ok).toBe(true)
    expect(generateLodgementAiSummary).not.toHaveBeenCalled()
    expect(upsert.mock.calls[0][0]).toMatchObject({ document_id: 'doc-1', ai_summary: null, ai_summary_generated_at: null })
  })

  it('writes the summary when staff run it', async () => {
    vi.mocked(generateLodgementAiSummary).mockResolvedValue({ text: 'Summary.', model: 'm' } as never)
    const { supabase, upsert } = mockUpsert()
    await analyseAndStoreLodgement(supabase, 'client-1', FILE, { aiSummary: true })
    expect(upsert.mock.calls[0][0]).toMatchObject({ ai_summary: 'Summary.', ai_summary_model: 'm' })
  })

  it('reports a CSV it cannot read', async () => {
    const { supabase } = mockUpsert()
    const outcome = await analyseAndStoreLodgement(supabase, 'client-1', { ...FILE, text: 'nonsense' }, { aiSummary: false })
    expect(outcome.ok).toBe(false)
  })
})

describe('ensureLodgementSummary', () => {
  function mockRow(row: Record<string, unknown> | null) {
    const update = vi.fn(() => ({ eq: async () => ({ error: null }) }))
    const chain: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'order', 'limit']) chain[m] = () => chain
    chain.maybeSingle = async () => ({ data: row })
    chain.update = update
    return { supabase: { from: () => chain } as never, update }
  }

  it('returns a summary already written, without calling the AI', async () => {
    const { supabase } = mockRow({ id: 'la-1', ai_summary: 'Old.', ai_summary_generated_at: '2026-10-01' })
    expect(await ensureLodgementSummary(supabase, 'c')).toEqual({ kind: 'generated', text: 'Old.', generatedAt: '2026-10-01' })
    expect(generateLodgementAiSummary).not.toHaveBeenCalled()
  })

  it('writes and stores one for figures from an automatic run', async () => {
    vi.mocked(generateLodgementAiSummary).mockResolvedValue({ text: 'New.', model: 'm' } as never)
    const { supabase, update } = mockRow({
      id: 'la-1',
      ai_summary: null,
      ai_summary_generated_at: null,
      dpn_risk: { totalGrossLate: 0 },
      debt_breakdown: {},
      number_of_late_lodgements: 2,
      cumulative_days_late: 40,
    })
    const outcome = await ensureLodgementSummary(supabase, 'c')
    expect(outcome).toMatchObject({ kind: 'generated', text: 'New.' })
    expect(update).toHaveBeenCalled()
  })

  it('writes none when nothing was late', async () => {
    const { supabase } = mockRow({
      id: 'la-1',
      ai_summary: null,
      ai_summary_generated_at: null,
      dpn_risk: { totalGrossLate: 0 },
      number_of_late_lodgements: 0,
      cumulative_days_late: 0,
    })
    expect(await ensureLodgementSummary(supabase, 'c')).toEqual({ kind: 'not_needed' })
    expect(generateLodgementAiSummary).not.toHaveBeenCalled()
  })
})

describe('ensureComparisonSummary', () => {
  function mockComparison(row: Record<string, unknown> | null) {
    const chain: Record<string, unknown> = {}
    chain.select = () => chain
    chain.eq = () => chain
    chain.maybeSingle = async () => ({ data: row })
    chain.update = () => ({ eq: async () => ({ error: null }) })
    return { from: () => chain } as never
  }

  it('summarises a current comparison that has none', async () => {
    vi.mocked(generateFinancialsComparisonSummary).mockResolvedValue({ text: 'Fin.', model: 'm' } as never)
    const outcome = await ensureComparisonSummary(
      mockComparison({ id: 'fc-1', computed: {}, ai_summary: null, ai_summary_generated_at: null, stale_since: null }),
      'c',
    )
    expect(outcome).toMatchObject({ kind: 'generated', text: 'Fin.' })
  })

  it('does not summarise a comparison that is out of date', async () => {
    const outcome = await ensureComparisonSummary(
      mockComparison({ id: 'fc-1', computed: {}, ai_summary: null, ai_summary_generated_at: null, stale_since: '2026-10-17' }),
      'c',
    )
    expect(outcome).toEqual({ kind: 'none' })
    expect(generateFinancialsComparisonSummary).not.toHaveBeenCalled()
  })
})
