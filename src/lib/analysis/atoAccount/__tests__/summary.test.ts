// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

/** When an ATO account's AI summary is written. Claude mocked; synthetic rows. */

const generate = vi.fn()
const enabled = vi.fn(() => true)
vi.mock('@/lib/ai/atoAccountSummary', () => ({ generateAtoAccountSummary: (...a: unknown[]) => generate(...a) }))
vi.mock('@/lib/ai/openrouterClient', () => ({ aiSummariesEnabled: () => enabled() }))
vi.mock('@/lib/supabase/server', () => ({ getSupabaseServerClient: vi.fn() }))

// Fresh modules, bound to THIS file's mocks (a single worker would otherwise keep another test file's).
vi.resetModules()
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

// A synthetic income tax account the ICA engine verifies: newest first, its running balance the answer key.
const ROWS = [
  { rowIndex: 0, processedDate: '2026-10-01', effectiveDate: '2026-10-01', description: 'Payment received', debit: null, credit: 1000, balance: 20100 },
  {
    rowIndex: 1,
    processedDate: '2026-04-16',
    effectiveDate: '2026-05-15',
    description: 'Tax return Companies - Income Tax for the period from 01 Jul 24 to 30 Jun 25',
    debit: 21100,
    credit: null,
    balance: 21100,
  },
]

const ROW = {
  id: 'an-1',
  // Verified against the ATO's own balance (migration 0058).
  ica_status: 'verified',
  ica_forced: {},
  ica_balance: 20100,
  ica_balance_date: '2026-10-01',
  account_kind: 'income_tax',
  account_label: 'Income tax 001',
  rows: ROWS,
  // The earlier engine's figures: no longer what is explained.
  unexplained_difference: 1250,
  balance: 1,
  balance_date: '2020-01-01',
  summary: {},
  needs_review: true,
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
  it('writes one from the summary on the ICA engine (the rows the ATO balance proved) and keeps it', async () => {
    generate.mockResolvedValue({ text: 'Summary.', model: 'anthropic/claude-sonnet-5.5' })
    const { supabase, updates } = db(ROW)
    const out = await ensureAtoAccountSummary(supabase, 'c1', 'an-1')
    expect(out).toMatchObject({ kind: 'generated', text: 'Summary.' })
    const input = generate.mock.calls[0][0]
    expect(input).toMatchObject({ kind: 'income_tax', balance: 20100, balanceDate: '2026-10-01' })
    expect(input.summary.assessedTotal).toBe(21100)
    expect(input.summary.payments).toMatchObject({ count: 1, total: 1000 })
    expect(input.summary.assessments[0]).toMatchObject({ amount: 21100, unpaid: 20100, paymentDue: '2026-05-15' })
    expect(updates[0]).toMatchObject({ ai_summary: 'Summary.', ai_summary_model: 'anthropic/claude-sonnet-5.5' })
  })

  it('returns the stored one without asking again, and none when the summaries are off', async () => {
    const stored = { ...ROW, ai_summary: 'Kept.', ai_summary_generated_at: '2026-10-26T00:00:00Z', ai_summary_model: 'anthropic/claude-sonnet-5.5' }
    expect(await ensureAtoAccountSummary(db(stored).supabase, 'c1', 'an-1')).toMatchObject({ kind: 'generated', text: 'Kept.' })
    enabled.mockReturnValue(false)
    expect(await ensureAtoAccountSummary(db(ROW).supabase, 'c1', 'an-1')).toEqual({ kind: 'not_needed' })
    expect(generate).not.toHaveBeenCalled()
  })

  it('writes none for a file not verified against the ATO balance, or whose rows no longer verify', async () => {
    const broken = ROWS.map((r) => (r.rowIndex === 0 ? { ...r, balance: 20000 } : r))
    for (const row of [{ ...ROW, ica_status: 'unverified' }, { ...ROW, ica_status: null }, { ...ROW, rows: broken }]) {
      expect(await ensureAtoAccountSummary(db(row).supabase, 'c1', 'an-1')).toEqual({ kind: 'not_needed' })
    }
    expect(generate).not.toHaveBeenCalled()
  })

  it('leaves activity statements to the lodgement summary', async () => {
    expect(await ensureAtoAccountSummary(db({ ...ROW, account_kind: 'activity_statement' }).supabase, 'c1', 'an-1')).toEqual({ kind: 'not_needed' })
  })
})
