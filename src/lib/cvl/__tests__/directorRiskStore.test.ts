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
        { id: 'sg-new', documentId: 'd1', kind: 'super_guarantee', label: 'Superannuation guarantee 551', balance: 400, balanceDate: '2026-09-30', needsReview: false, reviewedAt: null, entityMatches: true, olderFiles: 1 },
        { id: 'as-1', documentId: 'd2', kind: 'activity_statement', label: 'Activity statement 001', balance: 1000, balanceDate: '2026-09-30', needsReview: false, reviewedAt: null, entityMatches: true, olderFiles: 0 },
      ],
      totalDebt: 1400,
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
    await loadDirectorRisk(client, 'cl_1', { dpn: DPN, atoAccounts: { accounts: [], totalDebt: null } })
    expect(sgIn).not.toHaveBeenCalled()
  })
})
