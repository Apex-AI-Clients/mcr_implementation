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
// No statements on file: the figures come only from the confirmed line mapping (printed/mapping.ts).
vi.mock('@/lib/printed/store', () => ({
  loadPrintedComparison: vi.fn(async () => ({ comparison: { columns: [], tables: [], failures: [], documents: [], annualYears: 0 }, builtAt: null, unread: 0 })),
}))
vi.mock('@/lib/printed/mappingStore', () => ({ loadMapping: vi.fn(async () => []), loadDirectorNames: vi.fn(async () => []) }))
// The confirmed loan lines: $120,000 owed to the company on the balance sheet at 30 Jun 2026.
const line = (label: string, value: number) => ({ label, value, printed: -value, source: null, rule: null })
const FINANCIALS = {
  confirmed: true,
  balanceSheet: null,
  loanReceivable: { amount: 120_000, source: 'FY2026 balance sheet', asOf: '2026-06-30', lines: [line('Loan - Director', 120_000)] },
  loanPayable: { amount: 40_000, source: 'FY2026 balance sheet', asOf: '2026-06-30', lines: [line('Owner Funds Introduced', 40_000)] },
  notIdentified: {} as Record<string, unknown>,
  atoDebt: null,
  creditCards: null,
  cashLoans: null,
  bankOverdraft: null,
  tradeSuppliers: null,
}
vi.mock('@/lib/printed/mapping', () => ({
  predictionFinancials: vi.fn(() => FINANCIALS),
}))
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

/**
 * The predict API refuses a director loan flag the receivable amount contradicts,
 * unless staff give a reason, which it saves with the prediction. Synthetic data only.
 */

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

describe('POST predict-outcome — the director loan input', () => {
  beforeEach(() => {
    FINANCIALS.notIdentified = {}
  })

  it('uses the lines owed to the company, gross, and returns the payable and net beside it', async () => {
    const res = await PREDICT(post({ ...BASE, directorLoanAtAppointment: true }), PARAMS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(vi.mocked(predictSbrOutcome).mock.calls[0][0]).toMatchObject({ directorLoanReceivableAmount: 120_000, directorLoanAtAppointment: true })
    expect(body.directorLoan).toMatchObject({ basis: 'gross', amount: 120_000, receivable: 120_000, payable: 40_000, net: 80_000 })
    expect(body.directorLoan.info).toBe('“Owner Funds Introduced” $40,000.00 owed by the company; net $80,000.00 owed to the company')
    expect(body.directorLoanOverride).toBeNull()
    expect((upsert.mock.calls[0][0] as { input_overrides: unknown }).input_overrides).toBeNull()
  })

  it('never refuses a tick that differs from the amount: it records who changed it and when', async () => {
    const res = await PREDICT(post({ ...BASE, directorLoanAtAppointment: false }), PARAMS)
    expect(res.status).toBe(200)
    const saved = upsert.mock.calls[0][0] as { input_overrides: { directorLoanAtAppointment: Record<string, unknown> } }
    expect(saved.input_overrides.directorLoanAtAppointment).toMatchObject({ value: false, amount: 120_000 })
    expect(typeof saved.input_overrides.directorLoanAtAppointment.setBy).toBe('string')
    expect(typeof saved.input_overrides.directorLoanAtAppointment.setAt).toBe('string')
  })

  it('asks for the line when a loan line is not identified, never predicting on $0', async () => {
    FINANCIALS.notIdentified = { loanReceivable: { message: 'Not found in the statements — choose the line.', candidates: [] } }
    const res = await PREDICT(post({ ...BASE, directorLoanAtAppointment: false }), PARAMS)
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error).toBe('PREREQUISITES_MISSING')
    expect(body.missing).toEqual([
      {
        field: 'directorLoanReceivableAmount',
        blocker: 'line_mapping',
        actionUrl: '/clients/client-1/financials-comparison/mapping',
        message: 'Not found in the statements — choose the line.',
      },
    ])
    expect(predictSbrOutcome).not.toHaveBeenCalled()
  })
})
