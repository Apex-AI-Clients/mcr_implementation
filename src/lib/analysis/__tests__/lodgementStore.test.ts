// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/ai/lodgementSummary', () => ({
  generateLodgementAiSummary: vi.fn(),
  isClaudeSummary: (model: string | null) => !!model && model.startsWith('anthropic/'),
}))
vi.mock('@/lib/ai/openrouterClient', () => ({ aiSummariesEnabled: vi.fn(() => true) }))
// The check against the ATO's own balance (ica/verifyStore.ts) is its own unit; here only its answer matters.
vi.mock('@/lib/ica/verifyStore', () => ({ verifyAndStoreDocument: vi.fn(async () => ({ ok: true, status: 'verified' })) }))

import { generateLodgementAiSummary } from '@/lib/ai/lodgementSummary'
import { aiSummariesEnabled } from '@/lib/ai/openrouterClient'
import { verifyAndStoreDocument } from '@/lib/ica/verifyStore'
import { analyseAndStoreLodgement, ensureLodgementSummary, findActivityStatementCsv } from '../lodgementStore'

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
  vi.mocked(aiSummariesEnabled).mockReturnValue(true)
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
  let stored: Record<string, unknown> = {}
  const upsert = vi.fn((values: Record<string, unknown>) => {
    stored = { id: 'la-1', ...values }
    return { select: () => ({ single: async () => ({ data: stored, error: null }) }) }
  })
  const update = vi.fn((values: Record<string, unknown>) => {
    stored = { ...stored, ...values }
    return { eq: async () => ({ error: null }) }
  })
  const select = () => ({ eq: () => ({ single: async () => ({ data: stored, error: null }) }) })
  return { supabase: { from: () => ({ upsert, update, select }) } as never, upsert, update, current: () => stored }
}

const FILE = { doc: { id: 'doc-1', file_path: 'p', original_filename: 'renamed.csv' }, text: csv('Activity statement 002', LATE_ROW) }

describe('analyseAndStoreLodgement', () => {
  it('stores the figures with no summary, and never calls the AI or the check, in an automatic run', async () => {
    const { supabase, upsert } = mockUpsert()
    const outcome = await analyseAndStoreLodgement(supabase, 'client-1', FILE, { aiSummary: false })
    expect(outcome.ok).toBe(true)
    expect(generateLodgementAiSummary).not.toHaveBeenCalled()
    expect(verifyAndStoreDocument).not.toHaveBeenCalled()
    expect(upsert.mock.calls[0][0]).toMatchObject({ document_id: 'doc-1', ai_summary: null, ai_summary_generated_at: null })
  })

  it('checks the file against the ATO balance first, then writes the summary when staff run it', async () => {
    vi.mocked(generateLodgementAiSummary).mockResolvedValue({ text: 'Summary.', model: 'm' } as never)
    const { supabase, current } = mockUpsert()
    const outcome = await analyseAndStoreLodgement(supabase, 'client-1', FILE, { aiSummary: true, verify: true })
    expect(verifyAndStoreDocument).toHaveBeenCalledWith(supabase, 'client-1', 'doc-1')
    expect(current()).toMatchObject({ ai_summary: 'Summary.', ai_summary_model: 'm' })
    expect(outcome.ok && outcome.row).toMatchObject({ ai_summary: 'Summary.' })
  })

  it('writes no summary for a file that is not verified against the ATO balance', async () => {
    vi.mocked(verifyAndStoreDocument).mockResolvedValueOnce({ ok: true, status: 'unverified' })
    const { supabase, current } = mockUpsert()
    await analyseAndStoreLodgement(supabase, 'client-1', FILE, { aiSummary: true, verify: true })
    expect(generateLodgementAiSummary).not.toHaveBeenCalled()
    expect(current()).toMatchObject({ ai_summary: null })
  })

  it('writes no summary while the AI features are off', async () => {
    vi.mocked(aiSummariesEnabled).mockReturnValue(false)
    const { supabase, current } = mockUpsert()
    await analyseAndStoreLodgement(supabase, 'client-1', FILE, { aiSummary: true, verify: true })
    expect(generateLodgementAiSummary).not.toHaveBeenCalled()
    expect(current()).toMatchObject({ ai_summary: null })
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

  it('returns a summary Claude already wrote, without calling the AI', async () => {
    const { supabase } = mockRow({ id: 'la-1', ica_status: 'verified', ai_summary: 'Old.', ai_summary_generated_at: '2026-10-01', ai_summary_model: 'anthropic/claude-sonnet-5.5' })
    expect(await ensureLodgementSummary(supabase, 'c')).toEqual({ kind: 'generated', text: 'Old.', generatedAt: '2026-10-01' })
    expect(generateLodgementAiSummary).not.toHaveBeenCalled()
  })

  it('writes again a summary from before the switch to Claude (no figure check)', async () => {
    vi.mocked(generateLodgementAiSummary).mockResolvedValue({ text: 'New.', model: 'anthropic/claude-sonnet-5.5' } as never)
    const { supabase } = mockRow({
      id: 'la-1',
      ica_status: 'verified',
      ai_summary: 'Old.',
      ai_summary_generated_at: '2026-10-01',
      ai_summary_model: 'google/gemini-2.5-flash',
      dpn_risk: { totalGrossLate: 0 },
      debt_breakdown: {},
      number_of_late_lodgements: 2,
      cumulative_days_late: 40,
    })
    expect(await ensureLodgementSummary(supabase, 'c')).toMatchObject({ kind: 'generated', text: 'New.' })
  })

  it('writes none while the AI features are off', async () => {
    vi.mocked(aiSummariesEnabled).mockReturnValue(false)
    const { supabase } = mockRow({ id: 'la-1', ica_status: 'verified', ai_summary: null, ai_summary_generated_at: null, dpn_risk: { totalGrossLate: 0 }, number_of_late_lodgements: 2, cumulative_days_late: 40 })
    expect(await ensureLodgementSummary(supabase, 'c')).toEqual({ kind: 'not_needed' })
    expect(generateLodgementAiSummary).not.toHaveBeenCalled()
  })

  it('writes and stores one for figures from an automatic run', async () => {
    vi.mocked(generateLodgementAiSummary).mockResolvedValue({ text: 'New.', model: 'm' } as never)
    const { supabase, update } = mockRow({
      id: 'la-1',
      ica_status: 'verified',
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

  it('writes none for a file not verified against the ATO balance (or not checked yet)', async () => {
    for (const ica_status of ['unverified', null]) {
      const { supabase } = mockRow({ id: 'la-1', ica_status, ai_summary: null, dpn_risk: { totalGrossLate: 500 }, number_of_late_lodgements: 2, cumulative_days_late: 40 })
      expect(await ensureLodgementSummary(supabase, 'c')).toEqual({ kind: 'not_needed' })
    }
    expect(generateLodgementAiSummary).not.toHaveBeenCalled()
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
