import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DpnRiskPanel, ESTIMATE_LABEL, NOTICES_LABEL } from '../DpnRiskPanel'
import { DebtCompositionPanel, ROWS_SHOWN } from '../DebtCompositionPanel'
import { buildExportCsv } from '@/components/admin/LodgementAnalysisCard'
import { computeDebtBreakdown } from '@/lib/analysis/computeLateLodgement'
import type { DpnRiskBreakdown, EnrichedRow, LodgementAnalysisPayload, LodgementType } from '@/lib/analysis/types'
import type { DpnNoticeFigures } from '@/lib/dpn/noticeFigures'

/** The lodgement report's DPN panel, debt composition and CSV. Synthetic figures only. */

afterEach(cleanup)

let index = 0
function row(
  lodgementType: LodgementType,
  description: string,
  amounts: { debit?: number; credit?: number; balance?: number },
  date = '2026-03-01',
): EnrichedRow {
  const d = new Date(`${date}T00:00:00`)
  return {
    rowIndex: index++,
    processedDate: d,
    effectiveDate: d,
    rawProcessed: date,
    rawEffective: date,
    description,
    debit: amounts.debit ?? null,
    credit: amounts.credit ?? null,
    balance: amounts.balance ?? null,
    periodEnding: null,
    lodgementType,
    lateLodgementDays: 0,
    lateLodgeDaysCleaned: 0,
  }
}

const NOTICES: DpnNoticeFigures = {
  unpaid: 52_300,
  removable: 30_100,
  staysWithDirector: 22_200,
  deadline: '2026-10-21',
  daysLeft: 3,
  issuedOn: '2026-09-30',
  byType: [
    { type: 'paygw', label: 'PAYG withholding', unpaid: 30_000, removable: 29_000, staysWithDirector: 1_000, deadline: '2026-10-21' },
    { type: 'gst', label: 'GST', unpaid: 22_300, removable: 1_100, staysWithDirector: 21_200, deadline: '2026-10-21' },
  ],
  notices: 2,
}

const ESTIMATE: DpnRiskBreakdown = {
  thresholdDays: 90,
  contributingDebits: [
    {
      rowIndex: 1,
      processedDate: '2025-06-01T00:00:00.000Z',
      effectiveDate: '2024-11-28T00:00:00.000Z',
      periodEnding: '2024-09-30T00:00:00.000Z',
      description: 'Original Activity Statement for the period ending 30 Sep 24',
      daysLate: 185,
      debit: 8_000,
      reducedByAmendments: 3_000,
      netAtRisk: 5_000,
    },
  ],
  totalGrossLate: 8_000,
  totalReducedByAmendments: 3_000,
  totalNetAtRisk: 5_000,
  periodStart: '2024-07-01T00:00:00.000Z',
  periodEnd: '2026-03-01T00:00:00.000Z',
}

describe('DPN panel', () => {
  it("shows the notices' figures when notices are on file, with the estimate closed below", async () => {
    render(<DpnRiskPanel dpnRisk={ESTIMATE} notices={NOTICES} clientId="client-1" />)
    expect(screen.getByTestId('dpn-source').textContent).toBe(NOTICES_LABEL)
    expect(screen.getByText('$52,300')).toBeTruthy()
    expect(screen.getByText(/Removed if an SBR practitioner, administrator or liquidator is appointed, or it is paid, by 21 Oct 2026/)).toBeTruthy()
    expect(screen.getAllByText('Stays with the director unless paid').length).toBeGreaterThan(0)
    expect(screen.getByTestId('dpn-deadline').textContent).toMatch(/Deadline 21 Oct 2026 · 3 days left/)
    expect(screen.getByText('PAYG withholding')).toBeTruthy()
    expect(screen.getByRole('link', { name: /DPN Summary/ }).getAttribute('href')).toBe('/clients/client-1/director-penalty-notices')
    // The estimate is secondary and closed.
    expect(screen.queryByText('Reduced by later amendments')).toBeNull()
    const disclosure = screen.getByRole('button', { name: /Estimate from the ATO account/ })
    expect(disclosure.getAttribute('aria-expanded')).toBe('false')
    await userEvent.click(disclosure)
    expect(screen.getByText('Reduced by later amendments')).toBeTruthy()
  })

  it('labels the estimate as one, and never calls an amendment paid', async () => {
    const { container } = render(<DpnRiskPanel dpnRisk={ESTIMATE} notices={null} />)
    expect(screen.getByTestId('dpn-source').textContent).toBe(ESTIMATE_LABEL)
    expect(screen.getByText('Reduced by later amendments')).toBeTruthy()
    expect(screen.getByText('Estimated still owing')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /contributing rows/ }))
    expect(screen.getByRole('columnheader', { name: 'Reduced by later amendments' })).toBeTruthy()
    // No payment rows: the word "paid" appears nowhere.
    expect(container.textContent).not.toMatch(/\bpaid\b/i)
  })
})

describe('debt composition', () => {
  function sample() {
    index = 0
    const rows = [
      row('Original', 'Original Activity Statement for the period ending 31 Dec 25', { debit: 10_000, balance: 10_000 }, '2026-02-01'),
      row('SubLine', '- GST', { debit: 10_000 }, '2026-02-01'),
      row('GIC', 'General interest charge calculated from 01 Feb 26 to 28 Feb 26', { debit: 120, balance: 10_120 }, '2026-02-28'),
      row('Payment', 'Payment received', { credit: 2_000, balance: 8_120 }, '2026-03-05'),
    ]
    return { rows, breakdown: computeDebtBreakdown(rows) }
  }

  it('opens a line to its sentence and its ATO rows', async () => {
    const { rows, breakdown } = sample()
    render(<DebtCompositionPanel debtBreakdown={breakdown} rows={rows} />)
    const line = screen.getByRole('button', { name: /Tax lodged \(after amendments\)/ })
    expect(line.getAttribute('aria-expanded')).toBe('false')
    await userEvent.click(line)
    expect(line.getAttribute('aria-expanded')).toBe('true')
    const region = document.getElementById(line.getAttribute('aria-controls')!)!
    expect(within(region).getByText(/Activity statements lodged: \$10,000 charged/)).toBeTruthy()
    expect(within(region).getByText('Original Activity Statement for the period ending 31 Dec 25')).toBeTruthy()
  })

  it('lists the rows no line counts under the unexplained difference', async () => {
    const { rows, breakdown } = sample()
    render(<DebtCompositionPanel debtBreakdown={breakdown} rows={rows} />)
    await userEvent.click(screen.getByRole('button', { name: /Other adjustments \/ unexplained difference/ }))
    expect(screen.getByText(/minus what we can account for from the rows/)).toBeTruthy()
    expect(screen.getByText(/Lodgement sub-lines/)).toBeTruthy()
  })

  it(`shows the first ${ROWS_SHOWN} rows of a long line, then all`, async () => {
    index = 0
    const rows = Array.from({ length: ROWS_SHOWN + 5 }, (_, i) =>
      row('GIC', `General interest charge calculated, part ${i + 1}`, { debit: 1 }, '2026-02-01'),
    )
    render(<DebtCompositionPanel debtBreakdown={computeDebtBreakdown(rows)} rows={rows} />)
    await userEvent.click(screen.getByRole('button', { name: /Interest \(GIC\)/ }))
    expect(screen.queryByText(`General interest charge calculated, part ${ROWS_SHOWN + 1}`)).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: `Show all ${ROWS_SHOWN + 5} rows` }))
    expect(screen.getByText(`General interest charge calculated, part ${ROWS_SHOWN + 5}`)).toBeTruthy()
  })
})

describe('CSV export', () => {
  function payload(): LodgementAnalysisPayload {
    index = 0
    const rows = [
      row('Original', 'Original Activity Statement for the period ending 31 Dec 25', { debit: 10_000, balance: 10_000 }, '2026-02-01'),
      row('SubLine', '- GST', { debit: 10_000 }, '2026-02-01'),
    ]
    return {
      id: 'a1',
      clientId: 'client-1',
      documentId: 'd1',
      sourceFilename: 'SYNTH_account.csv',
      statementLabel: 'Activity statement 001',
      companyNameInCsv: 'SAMPLE TRADING PTY LTD',
      rowCount: rows.length,
      summary: { numberOfLateLodgements: 1, cumulativeDaysLate: 185 },
      dpnRisk: ESTIMATE,
      debtBreakdown: computeDebtBreakdown(rows),
      aiSummary: null,
      aiSummaryGeneratedAt: null,
      rows,
      warnings: [],
      analysedAt: '2026-03-02T00:00:00.000Z',
    }
  }

  it('has the composition, the rows by line and the rows not counted', () => {
    const csv = buildExportCsv(payload())
    expect(csv).toContain('DEBT COMPOSITION')
    expect(csv).toContain('ATO ROWS BY LINE')
    expect(csv).toContain('ROWS NOT COUNTED')
    expect(csv).toContain('Tax lodged (after amendments),"$10,000.00"')
    expect(csv).toContain(ESTIMATE_LABEL)
    expect(csv).toContain('Reduced by later amendments (same period only)')
    expect(csv).not.toMatch(/Paid since/i)
  })

  it("leads with the notices' figures when notices are on file", () => {
    const csv = buildExportCsv(payload(), NOTICES)
    expect(csv.indexOf(NOTICES_LABEL)).toBeGreaterThan(-1)
    expect(csv.indexOf(NOTICES_LABEL)).toBeLessThan(csv.indexOf('ESTIMATE FROM THE ATO ACCOUNT (secondary)'))
    expect(csv).toContain('Unpaid,"$52,300.00"')
  })
})
