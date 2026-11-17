import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))

import { HeldBackAccount, VerifiedComposition } from '../IcaParts'
import { LodgementAnalysisCard } from '@/components/admin/LodgementAnalysisCard'
import { computeLateLodgement } from '@/lib/analysis/computeLateLodgement'
import { parseActivityStatementCsv } from '@/lib/analysis/parseActivityStatement'
import type { LodgementAnalysisPayload } from '@/lib/analysis/types'
import { icaViewOf } from '@/lib/ica/view'

/**
 * The verification on the pages: badge and composition when verified, rows as printed otherwise. Synthetic rows.
 * Plain DOM assertions, as the rest of the suite (jest-dom is not registered).
 */

afterEach(cleanup)

const CSV = [
  '"Activity statement 002"',
  '"TEST ENTITY"',
  'Processed date,Effective date,Description,Debit (DR),Credit (CR),Balance',
  '"14 Sep 2026","26 May 2026","\'Original Activity Statement for the period ending 31 Mar 26","","","$1,000.00 DR"',
  '"14 Sep 2026","26 May 2026","\'- PAYG Withholding","$400.00","","$1,000.00 DR"',
  '"14 Sep 2026","26 May 2026","\'- GST","$600.00","","$600.00 DR"',
  '"01 Jun 2026","01 Jun 2026","\'Payment received","","$10.00","$0.00"',
].join('\r\n')
const result = computeLateLodgement(parseActivityStatementCsv(CSV))
const view = (status: string | null) => icaViewOf({ rows: result.rows, label: 'Activity statement 002', ica_status: status })

function payload(status: string | null): LodgementAnalysisPayload {
  return {
    id: 'a1',
    clientId: 'client-1',
    documentId: 'd1',
    sourceFilename: 'SYNTH.csv',
    statementLabel: 'Activity statement 002',
    companyNameInCsv: 'TEST ENTITY',
    rowCount: result.rows.length,
    summary: result.summary,
    dpnRisk: result.dpnRisk,
    debtBreakdown: result.debtBreakdown,
    aiSummary: null,
    aiSummaryGeneratedAt: null,
    rows: result.rows,
    warnings: [],
    unparsedDateRows: 0,
    analysedAt: '2026-11-17T00:00:00.000Z',
    verification: view(status),
  }
}

describe('HeldBackAccount', () => {
  it('says "Totals being prepared" and shows the rows exactly as printed, each with Copy', async () => {
    render(<HeldBackAccount view={view('unverified')} fileName="x" />)
    expect(screen.getByText('Totals being prepared')).toBeTruthy()
    await userEvent.click(screen.getByText(/ATO account, as printed \(4 rows\)/))
    expect(screen.getByText('- PAYG Withholding')).toBeTruthy()
    expect(screen.getByText('$400.00')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /^Copy:/ })).toHaveLength(4)
    expect(screen.getByRole('button', { name: /Download these rows \(Excel\)/ })).toBeTruthy()
  })
})

describe('VerifiedComposition', () => {
  it("shows the badge and every line in the ATO's words, each opening on its rows and what to search for", async () => {
    render(<VerifiedComposition view={view('verified')} fileName="x" />)
    expect(screen.getByTestId('ica-verified-badge').textContent).toContain("Matches the ATO's own balance: $1,000.00 DR at 14 Sep 2026")
    expect(screen.getByText('GST lodged')).toBeTruthy()
    await userEvent.click(screen.getByText('GST lodged'))
    expect(screen.getByText(/Search your spreadsheet for: “- GST”/)).toBeTruthy()
    expect(screen.queryByText(/unexplained/i)).toBeNull()
  })
})

describe('LodgementAnalysisCard', () => {
  it('verified: the badge and the composition; never an unexplained line', () => {
    render(<LodgementAnalysisCard clientId="client-1" initialAnalysis={payload('verified')} hasActivityStatementCsv />)
    expect(screen.getAllByTestId('ica-verified-badge').length).toBeGreaterThan(0)
    expect(screen.getByTestId('ica-composition')).toBeTruthy()
    expect(screen.queryByTestId('ica-held-back')).toBeNull()
    expect(screen.queryByText(/unexplained/i)).toBeNull()
  })

  it('not verified (or not checked yet): late lodgements and the rows as printed; no calculated figure, no export', () => {
    for (const status of ['unverified', null]) {
      render(<LodgementAnalysisCard clientId="client-1" initialAnalysis={payload(status)} hasActivityStatementCsv />)
      expect(screen.getByTestId('ica-held-back')).toBeTruthy()
      expect(screen.getByText('Number of Late Lodgements')).toBeTruthy()
      expect(screen.queryByTestId('ica-composition')).toBeNull()
      expect(screen.queryByTestId('ica-verified-badge')).toBeNull()
      expect(screen.queryByText('Director penalty notices')).toBeNull()
      expect(screen.queryByRole('button', { name: /^Export$/ })).toBeNull()
      cleanup()
    }
  })
})
