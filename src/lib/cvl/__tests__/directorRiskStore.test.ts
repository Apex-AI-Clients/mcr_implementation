// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/printed/store', () => ({ loadPrintedComparison: vi.fn(async () => ({ comparison: { columns: [], tables: [] } })) }))
vi.mock('@/lib/printed/mappingStore', () => ({ loadMapping: vi.fn(async () => []), applyAutoMapping: vi.fn(async (_s: unknown, _c: unknown, _l: unknown, saved: unknown) => ({ mapping: saved, possible: {} })), withAutoMapping: vi.fn(async (_s: unknown, _c: unknown, _l: unknown, saved: unknown) => ({ mapping: saved, possible: {}, names: { directors: [], parties: [] } })), loadRelatedNames: vi.fn(async () => ({ directors: [], parties: [] })) }))

import { loadDirectorRisk } from '../directorRiskStore'
import type { AtoAccountsOverview } from '@/lib/analysis/atoAccount/store'

/** Loading the director's risk: only what is already stored. Synthetic data only. */

const DPN = { notices: [], noneIssued: null, clearedNote: null, todayIso: '2026-11-03' }

function mockDb(lodgement: unknown, sg: unknown[]) {
  const sgIn = vi.fn<(col: string, ids: string[]) => Promise<{ data: unknown[] }>>(() => Promise.resolve({ data: sg }))
  const tables: Record<string, unknown> = {
    lodgement_analyses: { select: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve({ data: lodgement }) }) }) }) }) },
    ato_account_analyses: { select: () => ({ in: sgIn }) },
  }
  return { client: { from: (t: string) => tables[t] } as never, sgIn }
}

describe('loadDirectorRisk', () => {
  it('reads the newest super guarantee account summaries by id, and copes with a file with nothing on it', async () => {
    const overview: AtoAccountsOverview = {
      accounts: [
        { id: 'sg-new', documentId: 'd1', kind: 'super_guarantee', label: 'Superannuation guarantee 551', balance: 400, balanceDate: '2026-09-30', needsReview: false, reviewedAt: null, entityMatches: true, olderFiles: 1, unparsedDateRows: 0 },
        { id: 'as-1', documentId: 'd2', kind: 'activity_statement', label: 'Activity statement 001', balance: 1000, balanceDate: '2026-09-30', needsReview: false, reviewedAt: null, entityMatches: true, olderFiles: 0, unparsedDateRows: 0 },
      ],
      totalDebt: 1400,
      unreadable: [],
    }
    const { client, sgIn } = mockDb(null, [{ account_label: 'Superannuation guarantee 551', summary: { quarters: [] } }])
    const risk = await loadDirectorRisk(client, 'cl_1', { dpn: DPN, atoAccounts: overview })
    expect(sgIn).toHaveBeenCalledWith('id', ['sg-new'])
    expect(risk.sgAccounts).toEqual(['Superannuation guarantee 551'])
    expect(risk.activityStatement).toBeNull()
    expect(risk.potential.map((p) => [p.type, p.onTime, p.late])).toEqual([
      ['paygw', 0, 0],
      ['gst', 0, 0],
      ['sgc', 0, 0],
    ])
    expect(risk.issued).toEqual([])
    expect(risk.loans).toEqual([])
    expect(risk.totalAtoDebt).toBe(1400)
  })

  it('does not ask for super guarantee accounts when there are none', async () => {
    const { client, sgIn } = mockDb(null, [])
    await loadDirectorRisk(client, 'cl_1', { dpn: DPN, atoAccounts: { accounts: [], totalDebt: null, unreadable: [] } })
    expect(sgIn).not.toHaveBeenCalled()
  })
})

describe('loadDirectorRisk — ATO accounts whose dates could not be read', () => {
  const stored = (processed: string | null) => ({
    statement_label: 'Activity statement 001',
    analysed_at: '2026-10-01T00:00:00Z',
    rows: [
      { rowIndex: 0, rawProcessed: processed ?? '13/20/2026', rawEffective: processed ?? '13/20/2026', processedDate: null, effectiveDate: null, description: 'Original Activity Statement for the period ending 31 Mar 26 - PAYG withholding', debit: 8200, credit: null, balance: 8200 },
    ],
  })

  it('gives no PAYG withholding, GST or total when the activity statement dates cannot be read', async () => {
    const overview: AtoAccountsOverview = { accounts: [], totalDebt: 8200, unreadable: [] }
    const { client } = mockDb(stored(null), [])
    const risk = await loadDirectorRisk(client, 'cl_1', { dpn: DPN, atoAccounts: overview })
    expect(risk.potential.filter((p) => p.type !== 'sgc').map((p) => [p.type, p.onTime, p.late, p.items.length, p.unreadableRows])).toEqual([
      ['paygw', 0, 0, 0, 1],
      ['gst', 0, 0, 0, 1],
    ])
    expect(risk.totalAtoDebt).toBeNull()
    expect(risk.unreadable).toEqual([{ label: 'Activity statement 001', rows: 1 }])
  })

  it('reads them once the stored cells are readable (saved before the date fix)', async () => {
    const { client } = mockDb(stored('20-Oct-26'), [])
    const risk = await loadDirectorRisk(client, 'cl_1', { dpn: DPN, atoAccounts: { accounts: [], totalDebt: 8200, unreadable: [] } })
    expect(risk.unreadable).toEqual([])
    expect(risk.totalAtoDebt).toBe(8200)
    expect(risk.potential.every((p) => !p.unreadableRows)).toBe(true)
  })

  it('gives no SGC figure when a super guarantee account cannot be read', async () => {
    const overview: AtoAccountsOverview = {
      accounts: [{ id: 'sg', documentId: 'd', kind: 'super_guarantee', label: 'Superannuation guarantee 551', balance: null, balanceDate: null, needsReview: false, reviewedAt: null, entityMatches: true, olderFiles: 0, unparsedDateRows: 5 }],
      totalDebt: null,
      unreadable: [{ label: 'Superannuation guarantee 551', rows: 5 }],
    }
    const quarters = [{ total: 1000, events: [] }]
    const { client } = mockDb(null, [{ account_label: 'Superannuation guarantee 551', summary: { quarters }, rows: [], unparsed_date_rows: 5 }])
    const risk = await loadDirectorRisk(client, 'cl_1', { dpn: DPN, atoAccounts: overview })
    expect(risk.potential.find((p) => p.type === 'sgc')).toMatchObject({ onTime: 0, late: 0, items: [], unreadableRows: 5 })
    expect(risk.accounts[0]).toMatchObject({ balance: null, unparsedDateRows: 5 })
    expect(risk.unreadable).toEqual([{ label: 'Superannuation guarantee 551', rows: 5 }])
  })
})
