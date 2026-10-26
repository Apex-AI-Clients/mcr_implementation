// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

/** When an ATO account's AI summary is written. Claude mocked; synthetic rows. */

const generate = vi.fn()
const enabled = vi.fn(() => true)
vi.mock('@/lib/ai/atoAccountSummary', () => ({ generateAtoAccountSummary: (...a: unknown[]) => generate(...a) }))
vi.mock('@/lib/ai/openrouterClient', () => ({ aiSummariesEnabled: () => enabled() }))
vi.mock('@/lib/supabase/server', () => ({ getSupabaseServerClient: vi.fn() }))

const { ensureAtoAccountSummary } = await import('../store')

function db(row: Record<string, unknown> | null) {
  const updates: Record<string, unknown>[] = []
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data: row }),
    update: (values: Record<string, unknown>) => {
      updates.push(values)
      return { eq: async () => ({ error: null }) }
    },
  }
  return { supabase: { from: () => chain } as never, updates }
}

const ROW = {
  id: 'an-1',
  account_kind: 'income_tax',
  balance: 20100,
  balance_date: '2026-10-01',
  summary: { assessments: [], payments: { count: 0, total: 0, first: null, last: null }, gic: { charged: 0, remitted: 0, net: 0 } },
  needs_review: false,
  reviewed_at: null,
  ai_summary: null,
  ai_summary_generated_at: null,
  ai_summary_model: null,
}

beforeEach(() => {
  generate.mockReset()
  enabled.mockReturnValue(true)
})

describe('ensureAtoAccountSummary', () => {
  it('writes one from the stored figures and keeps it', async () => {
    generate.mockResolvedValue({ text: 'Summary.', model: 'anthropic/claude-sonnet-5.5' })
    const { supabase, updates } = db(ROW)
    const out = await ensureAtoAccountSummary(supabase, 'c1', 'an-1')
    expect(out).toMatchObject({ kind: 'generated', text: 'Summary.' })
    expect(generate.mock.calls[0][0]).toMatchObject({ kind: 'income_tax', balance: 20100, balanceDate: '2026-10-01' })
    expect(updates[0]).toMatchObject({ ai_summary: 'Summary.', ai_summary_model: 'anthropic/claude-sonnet-5.5' })
  })

  it('writes none while the analysis needs review', async () => {
    const { supabase } = db({ ...ROW, needs_review: true })
    expect(await ensureAtoAccountSummary(supabase, 'c1', 'an-1')).toEqual({ kind: 'locked' })
    expect(generate).not.toHaveBeenCalled()
  })

  it('writes one once reviewed', async () => {
    generate.mockResolvedValue({ text: 'Summary.', model: 'anthropic/claude-sonnet-5.5' })
    const { supabase } = db({ ...ROW, needs_review: true, reviewed_at: '2026-10-26T00:00:00Z' })
    expect((await ensureAtoAccountSummary(supabase, 'c1', 'an-1')).kind).toBe('generated')
  })

  it('returns the stored one without asking again, and none when the summaries are off', async () => {
    const stored = { ...ROW, ai_summary: 'Kept.', ai_summary_generated_at: '2026-10-26T00:00:00Z', ai_summary_model: 'anthropic/claude-sonnet-5.5' }
    expect(await ensureAtoAccountSummary(db(stored).supabase, 'c1', 'an-1')).toMatchObject({ kind: 'generated', text: 'Kept.' })
    enabled.mockReturnValue(false)
    expect(await ensureAtoAccountSummary(db(ROW).supabase, 'c1', 'an-1')).toEqual({ kind: 'not_needed' })
    expect(generate).not.toHaveBeenCalled()
  })

  it('leaves activity statements to the lodgement summary', async () => {
    expect(await ensureAtoAccountSummary(db({ ...ROW, account_kind: 'activity_statement' }).supabase, 'c1', 'an-1')).toEqual({ kind: 'not_needed' })
  })
})
