// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { analyseAndStoreAtoAccount, atoAccountsOverview, factorsSourceNote, type AtoAccountAnalysisRow } from '../store'
import { atoAccountCsv, exportLock, type AtoAccountPayload } from '../exportCsv'
import { analyseAtoAccount } from '..'

/** Storing ATO account analyses, the ATO accounts panel, and the CSV. Synthetic data only. */

const HEADER = 'Processed date,Effective date,Description,Debit (DR),Credit (CR),Balance'
const csv = (line1: string, rows: string[], entity = 'EXAMPLE TRADING PTY LTD') => [`"${line1}"`, `"${entity}"`, HEADER, ...rows].join('\n') + '\n'

const INCOME_TAX = csv('Income tax 001', [
  `"01 Oct 2026","01 Oct 2026","'General interest charge calculated from 01 Sep 26 to 30 Sep 26","$100.00","","$20,100.00 DR"`,
  `"16 Apr 2026","15 May 2026","' Tax return Companies - Income Tax for the period from 01 Jul 24 to 30 Jun 25","$20,000.00","","$20,000.00 DR"`,
  `"01 Apr 2026","01 Apr 2026","'Payment received","","$0.00","$0.00"`,
])
const ACTIVITY = csv('Activity statement 002', [
  `"01 Oct 2026","01 Oct 2026","'Payment received","","$500.00","$4,500.00 DR"`,
  `"28 Jul 2026","28 Jul 2026","'Original Activity Statement for the period ending 30 Jun 26 - GST","$5,000.00","","$5,000.00 DR"`,
])

function mockDb() {
  const writes: { table: string; values: Record<string, unknown> }[] = []
  const supabase = {
    from: (table: string) => ({
      upsert: async (values: Record<string, unknown>) => {
        writes.push({ table, values })
        return { error: null }
      },
    }),
  }
  return { supabase: supabase as never, writes }
}

describe('storing an analysis', () => {
  it('stores an income tax account, checking the entity against the client', async () => {
    const { supabase, writes } = mockDb()
    const outcome = await analyseAndStoreAtoAccount(supabase, 'client-1', 'doc-1', INCOME_TAX, ['Example Trading Pty Ltd'])
    expect(outcome).toEqual({ ok: true, kind: 'income_tax' })
    expect(writes).toHaveLength(1)
    expect(writes[0].table).toBe('ato_account_analyses')
    expect(writes[0].values).toMatchObject({
      client_id: 'client-1',
      document_id: 'doc-1',
      account_kind: 'income_tax',
      account_label: 'Income tax 001',
      balance: 20_100,
      balance_date: '2026-10-01',
      unexplained_difference: 0,
      needs_review: false,
      entity_matches: true,
    })
    // A re-run keeps who reviewed it and when.
    expect(writes[0].values).not.toHaveProperty('reviewed_at')
  })

  it('stores an activity statement for the panel, and never touches lodgement_analyses', async () => {
    const { supabase, writes } = mockDb()
    const outcome = await analyseAndStoreAtoAccount(supabase, 'client-1', 'doc-2', ACTIVITY, ['Someone Else Pty Ltd'])
    expect(outcome).toEqual({ ok: true, kind: 'activity_statement' })
    expect(writes.map((w) => w.table)).toEqual(['ato_account_analyses'])
    expect(writes[0].values).toMatchObject({ account_kind: 'activity_statement', balance: 4_500, needs_review: false, entity_matches: false })
  })

  it('stores nothing for an account type not recognised', async () => {
    const { supabase, writes } = mockDb()
    expect(await analyseAndStoreAtoAccount(supabase, 'c', 'd', csv('Fringe benefits tax 001', []), [])).toEqual({
      ok: false,
      error: 'Account type not recognised yet',
    })
    expect(writes).toHaveLength(0)
  })
})

function row(over: Partial<AtoAccountAnalysisRow>): AtoAccountAnalysisRow {
  return {
    id: 'a',
    document_id: 'd',
    client_id: 'c',
    account_kind: 'activity_statement',
    account_label: 'Activity statement 001',
    entity_name: null,
    entity_matches: null,
    balance: 0,
    balance_date: null,
    unexplained_difference: null,
    needs_review: false,
    reviewed_by: null,
    reviewed_at: null,
    composition: {},
    summary: {},
    rows: [],
    warnings: [],
    ai_summary: null,
    ai_summary_generated_at: null,
    ai_summary_model: null,
    analysed_at: '2026-10-20T00:00:00Z',
    ...over,
  }
}

describe('the ATO accounts panel', () => {
  it('takes the newest file per account, and nets credits off the total', () => {
    const overview = atoAccountsOverview([
      row({ id: 'as1-old', account_label: 'Activity statement 001', balance: 9_000, balance_date: '2026-06-30' }),
      row({ id: 'as1-new', account_label: 'Activity statement 001', balance: 10_000, balance_date: '2026-09-30' }),
      row({ id: 'as2', account_label: 'Activity statement 002', balance: -1_500, balance_date: '2026-09-30' }),
      row({ id: 'sg', account_kind: 'super_guarantee', account_label: 'Superannuation guarantee employer 005', balance: 50_000, balance_date: '2026-09-22', needs_review: true }),
      row({ id: 'it', account_kind: 'income_tax', account_label: 'Income tax 001', balance: 20_100, balance_date: '2026-10-01' }),
    ])
    expect(overview.accounts.map((a) => [a.id, a.balance, a.olderFiles])).toEqual([
      ['as1-new', 10_000, 1],
      ['as2', -1_500, 0],
      ['it', 20_100, 0],
      ['sg', 50_000, 0],
    ])
    expect(overview.totalDebt).toBe(78_600)
    expect(overview.accounts.find((a) => a.id === 'sg')?.needsReview).toBe(true)
  })

  it('has no total without a balance', () => {
    expect(atoAccountsOverview([row({ balance: null })]).totalDebt).toBeNull()
    expect(atoAccountsOverview([]).accounts).toEqual([])
  })
})

describe('which activity statement the SBR factors come from', () => {
  it('names the others only when there are some', () => {
    expect(factorsSourceNote('Activity statement 002', ['Activity statement 001', 'Activity statement 002', 'activity statement 001'])).toBe(
      'Factors come from Activity statement 002 (latest upload); this client also has: Activity statement 001.',
    )
    expect(factorsSourceNote('Activity statement 001', ['Activity statement 001'])).toBeNull()
    expect(factorsSourceNote(null, ['Activity statement 001'])).toBeNull()
  })
})

describe('the CSV and the lock', () => {
  const a = analyseAtoAccount(INCOME_TAX)
  const payload = {
    id: 'a',
    clientId: 'c',
    kind: 'income_tax',
    label: a.label,
    entityName: a.entityName,
    entityMatches: true,
    sourceFilename: null,
    balance: a.balance,
    balanceDate: a.balanceDate,
    unexplained: a.unexplainedDifference,
    needsReview: false,
    reviewedBy: null,
    reviewedAt: null,
    analysedAt: '2026-10-26T00:00:00Z',
    composition: a.composition,
    summary: a.summary,
  } as AtoAccountPayload

  it('locks the exports while an unexplained difference above $1,000 is not reviewed', () => {
    expect(exportLock({ needsReview: true, reviewedAt: null })).toMatch(/above \$1,000/)
    expect(exportLock({ needsReview: true, reviewedAt: '2026-10-26T00:00:00Z' })).toBeNull()
    expect(exportLock({ needsReview: false, reviewedAt: null })).toBeNull()
  })

  it('writes the balance, each assessment and the composition', () => {
    const text = atoAccountCsv(payload, 'Example Trading')
    expect(text).toContain('Balance owing,20100.00 DR,at 2026-10-01')
    expect(text).toContain('2024-07-01,2025-06-30,2026-04-16,2026-05-15,20000.00,20000.00,unpaid 139 days past the payment due date')
    expect(text).toContain("Note,Company income tax isn't covered by director penalty notices.")
    expect(text).toContain('DEBT COMPOSITION')
  })
})

vi.mock('@/lib/supabase/server', () => ({ getSupabaseServerClient: vi.fn() }))
