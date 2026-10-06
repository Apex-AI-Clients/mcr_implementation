// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { creditorDebt, daysSinceLastPayment, describeDecision, type IcaRow } from '../creditorDebt'
import { loadIcaRows } from '../icaRows'

/** The ATO account rows behind the creditor debt. SYNTHETIC rows and CSV. */

const CSV = [
  '"Activity statement 001"',
  '"SAMPLE PTY LTD"',
  'Processed date,Effective date,Description,Debit (DR),Credit (CR),Balance',
  '"26 Sep 2026","26 Sep 2026","General interest charge","$100.00","","$50,000.00 DR"',
  '"10 Sep 2026","10 Sep 2026","Payment received","","$1,000.00","$49,900.00 DR"',
].join('\r\n')

/** A stored analysis saved before the CSV fix: dates, but no balance on any row. */
const STALE: IcaRow[] = [
  { rowIndex: 0, processedDate: '2026-09-26T00:00:00.000Z', balance: null, lodgementType: 'GIC' },
  { rowIndex: 1, processedDate: '2026-09-10T00:00:00.000Z', balance: null, lodgementType: 'Payment' },
]

function supabase(csv: string | null) {
  const download = vi.fn(async () => (csv === null ? { data: null, error: { message: 'gone' } } : { data: new Blob([csv]), error: null }))
  return {
    client: {
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { file_path: 'documents/c/x.csv' } }) }) }) }),
      storage: { from: () => ({ download }) },
    } as never,
    download,
  }
}

describe('loadIcaRows', () => {
  it('uses the stored rows when they carry the balance', async () => {
    const rows: IcaRow[] = [{ processedDate: '2026-09-26', balance: 50_000 }]
    const { client, download } = supabase(CSV)
    expect(await loadIcaRows(client, { document_id: 'doc', rows })).toEqual({ rows, from: 'analysis' })
    expect(download).not.toHaveBeenCalled()
  })

  it('re-reads the uploaded CSV when the stored analysis predates the balance fix', async () => {
    const { client } = supabase(CSV)
    const result = await loadIcaRows(client, { document_id: 'doc', rows: STALE })
    expect(result.from).toBe('csv')
    const debt = creditorDebt({ icaRows: result.rows })
    expect(debt).toMatchObject({ source: 'ica', amount: 50_000, asOf: '2026-09-26', description: 'ATO account statement, 26 Sep 2026', icaNotUsed: null })
  })

  it('keeps the payments when re-reading the CSV, so days since the last payment stays real (not "no payments ever")', async () => {
    const { client } = supabase(CSV)
    const result = await loadIcaRows(client, { document_id: 'doc', rows: STALE })
    // Payment on 10 Sep 2026, statement 26 Sep 2026.
    expect(daysSinceLastPayment(result.rows)).toBe(16)
  })

  it('falls back to the stored rows when the CSV cannot be read', async () => {
    const { client } = supabase(null)
    expect(await loadIcaRows(client, { document_id: 'doc', rows: STALE })).toEqual({ rows: STALE, from: 'analysis' })
  })

  it('has nothing without an analysis', async () => {
    expect(await loadIcaRows(supabase(CSV).client, null)).toEqual({ rows: null, from: 'none' })
  })
})

describe('the logged decision', () => {
  it('says why the ATO account was not used', () => {
    const bs = { currentAssets: {}, nonCurrentAssets: {}, currentLiabilities: { gstPayable: 70_000 }, nonCurrentLiabilities: {}, equity: {}, totals: {} }
    const stale = creditorDebt({ icaRows: STALE, balanceSheet: bs, balanceSheetDate: '2025-06-30' })
    expect(describeDecision(stale)).toBe(
      'source=balance_sheet amount=70000 asOf=2025-06-30 icaNotUsed="the lodgement analysis rows carry no balance owing (re-run the lodgement analysis)"',
    )
    expect(creditorDebt({ icaRows: null, balanceSheet: bs }).icaNotUsed).toMatch(/no lodgement analysis/)
    expect(creditorDebt({ icaRows: STALE, staffAmount: 1 }).icaNotUsed).toBe('staff entered the amount')
  })
})
