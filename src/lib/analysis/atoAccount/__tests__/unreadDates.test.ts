// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { analyseAndStoreAtoAccount, atoAccountsOverview, storedUnparsedDateRows, type AtoAccountAnalysisRow } from '../store'
import { analyseAtoAccount } from '..'

/**
 * ATO account exports (income tax, super guarantee, activity statement for the
 * panel) whose dates could not be read: failed, never figures. Synthetic data only.
 */

const HEADER = 'Processed date,Effective date,Description,Debit (DR),Credit (CR),Balance'
const csv = (line1: string, rows: string[]) => [`"${line1}"`, '"EXAMPLE TRADING PTY LTD"', HEADER, ...rows].join('\n') + '\n'

const incomeTax = (d: [string, string, string, string, string, string]) =>
  csv('Income tax 001', [
    `"${d[0]}","${d[1]}","'General interest charge calculated from 01 Sep 26 to 30 Sep 26","$100.00","","$20,100.00 DR"`,
    `"${d[2]}","${d[3]}","' Tax return Companies - Income Tax for the period from 01 Jul 24 to 30 Jun 25","$20,000.00","","$20,000.00 DR"`,
    `"${d[4]}","${d[5]}","'Payment received","","$0.00","$0.00"`,
  ])

const ATO = incomeTax(['01 Oct 2026', '01 Oct 2026', '16 Apr 2026', '15 May 2026', '01 Apr 2026', '01 Apr 2026'])
const EXCEL = incomeTax(['1-Oct-26', '1-Oct-26', '16-Apr-26', '15-May-26', '1-Apr-26', '1-Apr-26'])
// US month-first, every day above 12: none can be read day-first.
const US = incomeTax(['10/13/2026', '10/13/2026', '04/16/2026', '05/15/2026', '04/20/2026', '04/20/2026'])

function mockDb() {
  const writes: Record<string, unknown>[] = []
  const supabase = { from: () => ({ upsert: async (values: Record<string, unknown>) => (writes.push(values), { error: null }) }) }
  return { supabase: supabase as never, writes }
}

function row(over: Partial<AtoAccountAnalysisRow>): AtoAccountAnalysisRow {
  return {
    id: 'a',
    document_id: 'd',
    client_id: 'c',
    account_kind: 'income_tax',
    account_label: 'Income tax 001',
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
    unparsed_date_rows: 0,
    ...over,
  }
}

describe('an income tax account re-saved in Excel', () => {
  it('is read as the ATO download is', () => {
    const excel = analyseAtoAccount(EXCEL)
    const ato = analyseAtoAccount(ATO)
    expect(excel.unparsedDateRows).toBe(0)
    expect([excel.balance, excel.balanceDate, excel.payments]).toEqual([ato.balance, ato.balanceDate, ato.payments])
  })

  it('counts rows whose dates cannot be read, and stores the count', async () => {
    expect(analyseAtoAccount(US).unparsedDateRows).toBe(3)
    const { supabase, writes } = mockDb()
    await analyseAndStoreAtoAccount(supabase, 'c', 'd', US, [])
    expect(writes[0]).toMatchObject({ account_kind: 'income_tax', unparsed_date_rows: 3 })
    const ok = mockDb()
    await analyseAndStoreAtoAccount(ok.supabase, 'c', 'd', ATO, [])
    expect(ok.writes[0]).toMatchObject({ unparsed_date_rows: 0 })
  })

  it('stores the count for an activity statement account too', async () => {
    const { supabase, writes } = mockDb()
    const as = csv('Activity statement 002', [`"10/13/2026","10/13/2026","'Payment received","","$500.00","$4,500.00 DR"`])
    await analyseAndStoreAtoAccount(supabase, 'c', 'd', as, [])
    expect(writes[0]).toMatchObject({ account_kind: 'activity_statement', unparsed_date_rows: 1 })
  })
})

describe('the ATO accounts overview', () => {
  it('counts unread dates from the stored column, or from stored rows saved before it', () => {
    expect(storedUnparsedDateRows(row({ unparsed_date_rows: 4 }))).toBe(4)
    expect(storedUnparsedDateRows(row({ rows: [{ processedDate: null, effectiveDate: null }, { processedDate: '2026-10-01', effectiveDate: '2026-10-01' }] }))).toBe(1)
    expect(storedUnparsedDateRows(row({}))).toBe(0)
  })

  it('shows a failed account with no balance, and gives no total', () => {
    const overview = atoAccountsOverview([
      row({ id: 'as', account_kind: 'activity_statement', account_label: 'Activity statement 001', balance: 10_000, balance_date: '2026-09-30' }),
      row({ id: 'it', balance: 20_100, balance_date: '2026-10-01', unparsed_date_rows: 34 }),
    ])
    const it = overview.accounts.find((a) => a.label === 'Income tax 001')!
    expect([it.balance, it.balanceDate, it.unparsedDateRows]).toEqual([null, null, 34])
    expect(overview.accounts.find((a) => a.label === 'Activity statement 001')!.balance).toBe(10_000)
    expect(overview.totalDebt).toBeNull()
    expect(overview.unreadable).toEqual([{ label: 'Income tax 001', rows: 34 }])
  })

  it('fails an account while any of its files has unreadable dates, even beside a readable one', () => {
    const overview = atoAccountsOverview([
      row({ id: 'good', balance: 20_100, balance_date: '2026-10-01' }),
      row({ id: 'bad', balance: 25_000, balance_date: null, unparsed_date_rows: 3, analysed_at: '2026-11-01T00:00:00Z' }),
    ])
    expect(overview.accounts).toHaveLength(1)
    expect(overview.accounts[0]).toMatchObject({ id: 'bad', balance: null, unparsedDateRows: 3, olderFiles: 1 })
    expect(overview.totalDebt).toBeNull()
  })

  it('is unchanged when every date is read', () => {
    const overview = atoAccountsOverview([row({ balance: 20_100, balance_date: '2026-10-01' })])
    expect(overview.totalDebt).toBe(20_100)
    expect(overview.unreadable).toEqual([])
    expect(overview.accounts[0].unparsedDateRows).toBe(0)
  })
})
