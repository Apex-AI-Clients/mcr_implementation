// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase/server', () => ({
  getSupabaseServerClient: vi.fn(),
  getSupabaseAuthClient: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'staff-1', app_metadata: {} } }, error: null }) },
  })),
}))
vi.mock('@/lib/sbr/loadReadiness', () => ({ loadReadiness: vi.fn() }))
vi.mock('@/lib/financials/storedStatements', () => ({ loadStoredSlots: vi.fn(async () => []) }))
vi.mock('@/lib/sbr/icaRows', () => ({ loadIcaRows: vi.fn() }))
vi.mock('@/lib/sbr/accuracy', () => ({ cachedLeaveOneOut: vi.fn(() => null) }))
vi.mock('@/lib/sbr/historicalCases', () => ({
  TRAINING_COLUMNS: '*',
  trainingSet: vi.fn(() => [{ id: 'case-1' }]),
  clientNames: vi.fn(() => []),
  withoutOwnRecord: vi.fn((cases: unknown[]) => cases),
}))
vi.mock('@/lib/sbr/predictOutcome', () => ({
  predictSbrOutcome: vi.fn((_input: unknown, _cases: unknown, options: { creditorAmount?: number; sbrPractitionerFeeRate: number }) => ({
    predictedOutcomePercent: 20,
    predictedLowPercent: 10,
    predictedHighPercent: 30,
    comparableCases: [],
    trainingSetSize: 1,
    suggestedOfferAmount: options.creditorAmount ? (0.2 * options.creditorAmount) / (1 - options.sbrPractitionerFeeRate) : null,
  })),
}))

import { getSupabaseServerClient } from '@/lib/supabase/server'
import { loadReadiness } from '@/lib/sbr/loadReadiness'
import { loadIcaRows } from '@/lib/sbr/icaRows'
import { predictSbrOutcome } from '@/lib/sbr/predictOutcome'
import { POST as PREDICT } from '@/app/api/admin/clients/[id]/predict-outcome/route'

/** The predict API sizes the offer on ATO debt + other creditors, and saves both. Synthetic data only. */

const PARAMS = { params: Promise.resolve({ id: 'client-1' }) }
const post = (body: unknown) => new NextRequest('http://localhost/x', { method: 'POST', body: JSON.stringify(body) })
const BASE = { paymentPlanType: 'upfront', directorLoanAtAppointment: false, practitionerFeeRate: 0.125 }

let upsert: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
  upsert = vi.fn(async () => ({ error: null }))
  const from = vi.fn((table: string) => {
    const chain: Record<string, unknown> = {}
    chain.select = () => (table === 'sbr_historical_cases' ? Promise.resolve({ data: [{}], error: null }) : chain)
    chain.eq = () => chain
    chain.order = () => chain
    chain.limit = () => chain
    chain.maybeSingle = async () => ({
      data:
        table === 'clients'
          ? { id: 'client-1', name: 'Example Client', company_details: null }
          : table === 'lodgement_analyses'
            ? { id: 'la-1', document_id: 'doc-1', number_of_late_lodgements: 2, cumulative_days_late: 40, rows: [], analysed_at: '2026-10-01' }
            : null,
    })
    chain.upsert = upsert
    return chain
  })
  vi.mocked(getSupabaseServerClient).mockReturnValue({ from } as never)
  vi.mocked(loadReadiness).mockResolvedValue({ items: [], canPredict: true, waitingFor: [], dpn: false } as never)
  // The ATO account says $100,000 is owed.
  vi.mocked(loadIcaRows).mockResolvedValue({
    rows: [{ rowIndex: 0, processedDate: '2026-09-30', balance: 100_000, lodgementType: 'Original' }],
    from: 'stored',
  } as never)
})

describe('POST predict-outcome — creditors in the SBR', () => {
  it('sizes the offer on ATO debt plus the other rows, and saves them', async () => {
    const res = await PREDICT(
      post({
        ...BASE,
        creditors: [
          { label: 'Credit cards', amount: 12_000 },
          { label: 'Bank overdraft', amount: null },
          { label: 'Supplier – steel', amount: 38_000 },
        ],
      }),
      PARAMS,
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(vi.mocked(predictSbrOutcome).mock.calls[0][2]).toMatchObject({ creditorAmount: 150_000 })
    expect(body.creditorAmount).toBe(150_000)
    expect(body.atoDebt).toBe(100_000)
    expect(body.creditors).toHaveLength(3)
    expect(body.creditors[2]).toEqual({ label: 'Supplier – steel', amount: 38_000 })
    // 20% × 150,000 ÷ 0.875
    expect(body.suggestedOfferAmount).toBeCloseTo(34_285.71, 1)

    const saved = upsert.mock.calls[0][0] as Record<string, unknown>
    expect(saved.total_creditor_amount).toBe(150_000)
    expect(saved.creditors).toMatchObject({ atoDebt: 100_000, atoDebtEdited: false })
    expect((saved.creditors as { rows: unknown[] }).rows).toHaveLength(3)
  })

  it("uses staff's ATO debt in the total when they typed one", async () => {
    const res = await PREDICT(post({ ...BASE, creditorAmount: 80_000, creditors: [{ label: 'Credit cards', amount: 5_000 }] }), PARAMS)
    const body = await res.json()
    expect(body.creditorAmount).toBe(85_000)
    expect((upsert.mock.calls[0][0] as { creditors: { atoDebtEdited: boolean } }).creditors.atoDebtEdited).toBe(true)
  })

  it('is the ATO debt alone when no other row has an amount', async () => {
    const body = await (await PREDICT(post(BASE), PARAMS)).json()
    expect(body.creditorAmount).toBe(100_000)
  })

  it('keeps the kind of a renamed row', async () => {
    const body = await (await PREDICT(post({ ...BASE, creditors: [{ label: 'Visa card', amount: 2_000, kind: 'creditCards' }] }), PARAMS)).json()
    expect(body.creditors).toEqual([{ label: 'Visa card', amount: 2_000, kind: 'creditCards' }])
  })

  it('refuses more than 20 rows, an unknown kind, or a negative amount', async () => {
    const many = Array.from({ length: 21 }, () => ({ label: 'x', amount: 1 }))
    expect((await PREDICT(post({ ...BASE, creditors: many }), PARAMS)).status).toBe(400)
    expect((await PREDICT(post({ ...BASE, creditors: [{ label: 'x', amount: 1, kind: 'equipmentFinance' }] }), PARAMS)).status).toBe(400)
    expect((await PREDICT(post({ ...BASE, creditors: [{ label: 'x', amount: -1 }] }), PARAMS)).status).toBe(400)
  })
})

describe('POST predict-outcome — the DPN factor', () => {
  const dpnSent = () => (vi.mocked(predictSbrOutcome).mock.calls.at(-1)![0] as { dpn: boolean }).dpn

  it("uses staff's answer when nothing is on file, and No when they gave none", async () => {
    vi.mocked(loadReadiness).mockResolvedValue({ items: [], canPredict: true, waitingFor: [], dpn: null } as never)
    expect((await PREDICT(post({ ...BASE, dpn: true }), PARAMS)).status).toBe(200)
    expect(dpnSent()).toBe(true)
    await PREDICT(post(BASE), PARAMS)
    expect(dpnSent()).toBe(false)
  })

  it('ignores the answer when the file settles it', async () => {
    vi.mocked(loadReadiness).mockResolvedValue({ items: [], canPredict: true, waitingFor: [], dpn: true } as never)
    await PREDICT(post({ ...BASE, dpn: false }), PARAMS)
    expect(dpnSent()).toBe(true)
  })
})
