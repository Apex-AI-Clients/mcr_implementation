import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { unsourcedAmounts } from '@/test/sourcedAmounts'
import { SourcedAmount } from '@/components/ui/SourcedAmount'
import { AtoAccountReport } from '@/components/admin/atoAccount/AtoAccountReport'
import { AtoAccountsPanel } from '@/components/admin/AtoAccountsPanel'
import { DebtCompositionPanel } from '@/components/admin/lodgement/DebtCompositionPanel'
import { DpnRiskPanel } from '@/components/admin/lodgement/DpnRiskPanel'
import { OutcomePredictionClient } from '@/app/(app)/clients/[id]/outcome-prediction/OutcomePredictionClient'
import { analyseAtoAccount } from '@/lib/analysis/atoAccount'
import { computeDebtBreakdown } from '@/lib/analysis/computeLateLodgement'
import { predictSbrOutcome } from '@/lib/sbr/predictOutcome'
import type { AtoAccountPayload } from '@/lib/analysis/atoAccount/exportCsv'
import type { EnrichedRow } from '@/lib/analysis/types'
import type { HistoricalSbrCase } from '@/lib/sbr/types'

/**
 * No amount on an SBR page without its source: every standalone dollar figure
 * these pages render sits in a SourcedAmount with a source (test/sourcedAmounts.ts).
 * A new amount added without one fails here. Synthetic figures only.
 */

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => '/' }))
vi.mock('@/components/admin/ExportPdfButton', () => ({ ExportPdfButton: () => null }))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const HEADER = 'Processed date,Effective date,Description,Debit (DR),Credit (CR),Balance'
const csv = (line1: string, rows: string[]) => [`"${line1}"`, '"EXAMPLE TRADING PTY LTD"', HEADER, ...rows].join('\n') + '\n'

function payload(text: string): AtoAccountPayload {
  const a = analyseAtoAccount(text)
  return {
    id: 'a',
    clientId: 'c1',
    kind: a.kind,
    label: a.label,
    entityName: a.entityName,
    entityMatches: true,
    sourceFilename: null,
    balance: a.balance,
    balanceDate: a.balanceDate,
    unexplained: a.unexplainedDifference,
    needsReview: false,
    reviewedBy: null,
    reviewedAt: '2026-10-26T00:00:00Z',
    analysedAt: '2026-10-26T00:00:00Z',
    composition: a.composition,
    summary: a.summary,
    aiSummary: null,
    aiSummaryGeneratedAt: null,
  } as AtoAccountPayload
}

describe('every amount has a source', () => {
  it('warns in development, and marks the amount, when one has none', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { container } = render(<SourcedAmount value={1_234} source={null} />)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('$1,234 is shown without a source'))
    expect(unsourcedAmounts(container)).toEqual(['$1,234'])
  })

  it('the income tax account page', () => {
    const { container } = render(
      <AtoAccountReport
        clientName="Example Trading"
        payload={payload(
          csv('Income tax 001', [
            `"01 Oct 2026","01 Oct 2026","'General interest charge calculated from 01 Sep 26 to 30 Sep 26","$100.00","","$20,100.00 DR"`,
            `"16 Apr 2026","15 May 2026","' Tax return Companies - Income Tax for the period from 01 Jul 24 to 30 Jun 25","$20,000.00","","$20,000.00 DR"`,
            `"01 Apr 2026","31 Mar 2026","'Payment received","","$500.00","$0.00"`,
            `"01 Mar 2026","01 Mar 2026","'General interest charge calculated from 01 Feb 26 to 28 Feb 26","$500.00","","$500.00 DR"`,
          ]),
        )}
      />,
    )
    expect(unsourcedAmounts(container)).toEqual([])
    expect(container.querySelectorAll('[data-sourced="yes"]').length).toBeGreaterThan(5)
  })

  it('the superannuation guarantee account page', () => {
    const { container } = render(
      <AtoAccountReport
        clientName="Example Trading"
        payload={payload(
          csv('Superannuation guarantee employer 005', [
            `"17 Sep 2026","04 Nov 2026","'SG Part 7 penalty - remission","","$600.00","$5,900.00 DR"`,
            `"17 Sep 2026","04 Nov 2026","'SG Part 7 penalty","$1,000.00","","$6,500.00 DR"`,
            `"16 Sep 2026","16 Sep 2026","'SGC Statement (Liability) - SG Administration Fee for the period from 01 Jan 26 to 31 Mar 26","$500.00","","$5,500.00 DR"`,
            `"16 Sep 2026","16 Sep 2026","'SGC Statement (Liability) - SG Shortfall for the period from 01 Jan 26 to 31 Mar 26","$5,000.00","","$5,000.00 DR"`,
            `"16 Sep 2026","16 Sep 2026","'Default SGC Statement (Liability) - Superannuation Guarantee (Quarterly) for the period from 01 Jan 26 to 31 Mar 26","","$0.00","$0.00"`,
          ]),
        )}
      />,
    )
    expect(unsourcedAmounts(container)).toEqual([])
  })

  it('the ATO accounts panel and its total', () => {
    const { container } = render(
      <AtoAccountsPanel
        clientId="c1"
        overview={{
          accounts: [
            { id: 'a', documentId: 'd', kind: 'activity_statement', label: 'Activity statement 001', balance: 10_000, balanceDate: '2026-09-30', needsReview: false, reviewedAt: null, entityMatches: true, olderFiles: 0 },
            { id: 'b', documentId: 'e', kind: 'income_tax', label: 'Income tax 001', balance: -500, balanceDate: '2026-10-01', needsReview: false, reviewedAt: null, entityMatches: true, olderFiles: 0 },
          ],
          totalDebt: 9_500,
        }}
      />,
    )
    expect(unsourcedAmounts(container)).toEqual([])
  })

  it('the lodgement analysis: debt composition and the DPN figures', () => {
    let i = 0
    const row = (lodgementType: EnrichedRow['lodgementType'], description: string, debit: number | null, credit: number | null, balance: number | null): EnrichedRow => {
      const d = new Date('2026-03-01T00:00:00')
      return { rowIndex: i++, processedDate: d, effectiveDate: d, rawProcessed: '01 Mar 2026', rawEffective: '01 Mar 2026', description, debit, credit, balance, periodEnding: null, lodgementType, lateLodgementDays: 0, lateLodgeDaysCleaned: 0 }
    }
    const rows = [row('Payment', 'Payment received', null, 1_000, 4_000), row('Original', 'Original Activity Statement', 5_000, null, 5_000)]
    const composition = render(<DebtCompositionPanel debtBreakdown={computeDebtBreakdown(rows)} rows={rows} />)
    expect(unsourcedAmounts(composition.container)).toEqual([])
    cleanup()

    const dpn = render(
      <DpnRiskPanel
        clientId="c1"
        dpnRisk={{
          thresholdDays: 90,
          contributingDebits: [{ rowIndex: 1, processedDate: '2025-06-01T00:00:00.000Z', effectiveDate: '2024-11-28T00:00:00.000Z', periodEnding: '2024-09-30T00:00:00.000Z', description: 'Original Activity Statement', daysLate: 185, debit: 8_000, reducedByAmendments: 3_000, netAtRisk: 5_000 }],
          totalGrossLate: 8_000,
          totalReducedByAmendments: 3_000,
          totalNetAtRisk: 5_000,
          periodStart: '2024-07-01T00:00:00.000Z',
          periodEnd: '2026-03-01T00:00:00.000Z',
        }}
        notices={{
          unpaid: 52_300,
          removable: 30_100,
          staysWithDirector: 22_200,
          deadline: '2026-10-21',
          daysLeft: 3,
          issuedOn: '2026-09-30',
          byType: [{ type: 'paygw', label: 'PAYG withholding', unpaid: 52_300, removable: 30_100, staysWithDirector: 22_200, deadline: '2026-10-21' }],
          notices: 1,
        }}
        paymentRows={rows}
      />,
    )
    expect(unsourcedAmounts(dpn.container)).toEqual([])
  })

  it('the prediction page: inputs, creditors, the offer and the past cases', async () => {
    const features = { dpn: true, paymentPlanType: 'upfront' as const, directorLoanAtAppointment: true, directorLoanReceivableAmount: 50_000, cumulativeDaysLate: 400, numberOfLateLodgements: 8, daysSinceLastPayment: 120 }
    const cases: HistoricalSbrCase[] = Array.from({ length: 10 }, (_, k) => ({
      id: `case-${k}`,
      clientName: `Past Case ${k}`,
      features: { ...features, directorLoanReceivableAmount: 10_000 * k, cumulativeDaysLate: 300 + 20 * k },
      outcomePercent: 20 + k * 3,
      accepted: k % 3 !== 0,
      creditorAmount: 200_000 + k * 10_000,
      sbrPayment: 40_000 + k * 5_000,
    }))
    const prediction = {
      ...predictSbrOutcome(features, cases, { creditorAmount: 260_000, sbrPractitionerFeeRate: 0.125 }),
      inputFeatures: features,
      creditorAmount: 260_000,
      atoDebt: 250_000,
      creditors: [{ label: 'Credit cards', amount: 10_000 }],
      creditorDebt: { description: 'ATO account statement, 1 Oct 2026', missing: null, source: 'ica' },
      computedAt: '2026-10-26T00:00:00Z',
      directorLoanAsOf: '2026-06-30',
      directorLoanOverride: null,
    }
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => prediction })))
    const line = { label: 'Loan - Director', value: 50_000, printed: -50_000, source: { documentId: 'd', filename: 'fy26.pdf', page: 2, text: 'Loan - Director (50,000)', header: '2026' }, rule: 'A negative figure under liabilities means the director (or related party) owes the company.' }
    const { container } = render(
      <OutcomePredictionClient
        clientId="c1"
        clientName="Example Trading"
        initialAuto={{
          cumulativeDaysLate: 400,
          numberOfLateLodgements: 8,
          daysSinceLastPayment: 120,
          directorLoanReceivableAmount: 50_000,
          directorLoanDetected: true,
          directorLoanReasoning: null,
          directorLoanAsOf: '2026-06-30',
          directorLoan: { notIdentified: null, amount: 50_000, basis: 'gross', receivable: 50_000, payable: 0, net: 50_000, receivableLines: [line], payableLines: [], source: 'FY2026 balance sheet', asOf: '2026-06-30', info: null },
          mappingUrl: '/clients/c1/financials-comparison/mapping',
          creditorAmount: 250_000,
          creditorSource: 'ATO account statement, 1 Oct 2026',
          creditorMissing: null,
          latestFinancialYear: 2026,
          hasLodgement: true,
          hasFinancials: true,
          creditorHints: { creditCards: { amount: 4_200, source: 'FY2026 balance sheet', caution: null }, cashLoans: null, bankOverdraft: null, tradeSuppliers: null },
          savedCreditors: { atoDebt: 250_000, atoDebtEdited: false, rows: [{ label: 'Credit cards', amount: 10_000, kind: 'creditCards' }] },
        }}
        initialPrediction={{
          inputFeatures: features,
          predictedOutcomePercent: 30,
          predictedLowPercent: 20,
          predictedHighPercent: 40,
          comparableCaseIds: [],
          trainingSetSize: 10,
          computedAt: '2026-10-26T00:00:00Z',
          practitionerFeeRate: 0.125,
          stale: false,
          inputsChanged: [],
        }}
        readiness={{ canPredict: true, waitingFor: [], dpn: true, dpnDetail: '1 notice read.' }}
      />,
    )
    // The saved prediction is computed again on load: the result renders.
    await waitFor(() => expect(screen.getByText('Creditors in the SBR', { selector: 'h3' })).toBeTruthy())
    expect(unsourcedAmounts(container)).toEqual([])
    expect(container.querySelectorAll('[data-sourced="yes"]').length).toBeGreaterThan(5)
  })
})

describe('server components', () => {
  it('pass the amount as text, never a formatter (functions cannot reach a client component)', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs')
    const path = await import('node:path')
    const files: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name)
        if (statSync(full).isDirectory()) {
          if (name !== '__tests__') walk(full)
        } else if (full.endsWith('.tsx')) files.push(full)
      }
    }
    walk(path.join(process.cwd(), 'src'))
    const offenders = files.filter((f) => {
      const text = readFileSync(f, 'utf8')
      return text.includes('<SourcedAmount') && !/^['"]use client['"]/.test(text.trimStart()) && /<SourcedAmount[^>]*\bformat=\{/.test(text)
    })
    expect(offenders).toEqual([])
  })
})
