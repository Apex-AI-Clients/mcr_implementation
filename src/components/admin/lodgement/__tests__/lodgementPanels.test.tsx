import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DpnRiskPanel, NOTICES_LABEL } from '../DpnRiskPanel'
import { DebtCompositionPanel, ROWS_SHOWN } from '../DebtCompositionPanel'
import { buildExportCsv } from '@/components/admin/LodgementAnalysisCard'
import { computeDebtBreakdown } from '@/lib/analysis/computeLateLodgement'
import type { DpnRiskBreakdown, EnrichedRow, LodgementAnalysisPayload, LodgementType } from '@/lib/analysis/types'
import type { DpnNoticeFigures } from '@/lib/dpn/noticeFigures'
import { icaViewOf } from '@/lib/ica/view'

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
  items: [],
  heldBack: false,
  badges: ['Notice adds up', 'Matches the ATO account'],
}

const ESTIMATE: DpnRiskBreakdown = {
  thresholdDays: 90,
  // One statement lodged 185 days late, by tax line (GST and PAYG withholding each on its own).
  contributingDebits: [
    {
      rowIndex: 1,
      processedDate: '2025-06-01T00:00:00.000Z',
      effectiveDate: '2024-11-28T00:00:00.000Z',
      periodEnding: '2024-09-30T00:00:00.000Z',
      description: 'Original Activity Statement for the period ending 30 Sep 24 — GST',
      taxLine: 'GST',
      daysLate: 185,
      debit: 5_000,
      reducedByAmendments: 0,
      netAtRisk: 5_000,
    },
    {
      rowIndex: 2,
      processedDate: '2025-06-01T00:00:00.000Z',
      effectiveDate: '2024-11-28T00:00:00.000Z',
      periodEnding: '2024-09-30T00:00:00.000Z',
      description: 'Original Activity Statement for the period ending 30 Sep 24 — PAYG Withholding',
      taxLine: 'PAYG Withholding',
      daysLate: 185,
      debit: 3_000,
      reducedByAmendments: 0,
      netAtRisk: 3_000,
    },
  ],
  totalGrossLate: 8_000,
  totalReducedByAmendments: 0,
  totalNetAtRisk: 8_000,
  window: {
    start: '2024-03-15',
    startBalance: 0,
    startUnder1000: '2024-03-15',
    startingCredit: 0,
    openingDebt: 0,
    payments: 0,
    paymentsCount: 0,
    otherTaxDebts: 0,
    otherTaxDebtsPaid: 0,
    grossLateAllHistory: 9_500,
  },
  periodStart: '2024-07-01T00:00:00.000Z',
  periodEnd: '2026-03-01T00:00:00.000Z',
}

const NOTICE_ITEM: DpnNoticeFigures['items'][number] = {
  documentId: 'doc-paygw',
  filename: 'notice.pdf',
  type: 'paygw',
  label: 'PAYG withholding',
  reference: 'REF',
  issuedOn: '2026-09-30',
  deadline: '2026-10-21',
  daysLeft: 3,
  headings: { column2: 'Amount withheld', column3: 'Unpaid', column4: 'Removed by 21 Oct 2026', column5: 'Stays with the director unless paid' },
  rows: [{ periodFrom: '2024-07-01', periodTo: '2024-09-30', column2: 30_000, column3: 30_000, column4: 29_000, column5: 1_000 }],
  totals: { column2: 30_000, column3: 30_000, column4: 29_000, column5: 1_000 },
  proof: { status: 'verified', badges: ['Notice adds up', 'Matches the ATO account'], note: null, rowsNotAddingUp: [], mismatches: [] },
}

describe('DPN panel (Gabby, 16 Nov 2026)', () => {
  it('shows the two cards side by side, each saying where it comes from', () => {
    render(<DpnRiskPanel dpnRisk={ESTIMATE} notices={{ ...NOTICES, items: [NOTICE_ITEM] }} clientId="client-1" />)
    const section = screen.getByTestId('director-penalty-section')
    expect(section.textContent).toContain(NOTICES_LABEL)
    expect(section.textContent).toContain('$52,300.00')
    expect(section.textContent).toContain('From the ATO account')
    expect(section.textContent).toContain('Lodged more than 90 days late since the balance was last nil')
    expect(section.textContent).toContain('$8,000.00')
    // The cards: their total, source and badge only; the split is in "By tax type" (18 Nov 2026).
    const cards = section.querySelector('.grid')!.textContent!
    expect(cards).toContain('Since 15 Mar 2024')
    expect(cards).not.toMatch(/GST \$5,000\.00|PAYG withholding \$|each counted on its own/)
    expect(screen.getByRole('link', { name: /DPN Summary/ }).getAttribute('href')).toBe('/clients/client-1/director-penalty-notices')
  })

  it('splits both cards by tax type below them, the total row equal to the cards', () => {
    const gst = { ...NOTICE_ITEM, documentId: 'doc-gst', type: 'gst' as const, label: 'GST', deadline: '2026-10-10', daysLeft: -8 }
    render(<DpnRiskPanel dpnRisk={ESTIMATE} notices={{ ...NOTICES, items: [NOTICE_ITEM, gst] }} />)
    const table = within(screen.getByTestId('dpn-by-tax-type')).getByRole('table')
    const row = (key: string) => [...table.querySelectorAll(`tr[data-row="${key}"] td`)].map((c) => c.textContent)
    expect(within(table).getAllByRole('rowheader').map((h) => h.textContent)).toEqual(['PAYG withholding', 'GST', 'Total'])
    expect(row('paygw')).toEqual(['$30,000.00', '$29,000.00', '$1,000.00', '21 Oct 2026', '$3,000.00'])
    expect(row('gst')).toEqual(['$22,300.00', '$1,100.00', '$21,200.00', 'Deadline passed 10 Oct 2026', '$5,000.00'])
    expect(row('total')).toEqual(['$52,300.00', '$30,100.00', '$22,200.00', '', '$8,000.00'])
  })

  it('by tax type: "Being prepared" for a type whose notice is not proven, "No notice uploaded" for one without', () => {
    const held = { ...NOTICE_ITEM, proof: { ...NOTICE_ITEM.proof, status: 'unverified' as const } }
    render(<DpnRiskPanel dpnRisk={ESTIMATE} notices={{ ...NOTICES, heldBack: true, items: [held] }} />)
    const table = within(screen.getByTestId('dpn-by-tax-type')).getByRole('table')
    const row = (key: string) => [...table.querySelectorAll(`tr[data-row="${key}"] td`)].map((c) => c.textContent)
    expect(row('paygw').slice(0, 3)).toEqual(['Being prepared', 'Being prepared', 'Being prepared'])
    expect(row('gst').slice(0, 3)).toEqual(['No notice uploaded', 'No notice uploaded', 'No notice uploaded'])
    // The ATO account column does not wait for the notices.
    expect(row('gst')[4]).toBe('$5,000.00')
  })

  it('says so when no notice is uploaded', () => {
    render(<DpnRiskPanel dpnRisk={ESTIMATE} notices={null} />)
    expect(screen.getAllByText(/No director penalty notice uploaded/).length).toBeGreaterThan(0)
  })

  it('no longer shows the removed cards or the estimate panel', () => {
    const { container } = render(<DpnRiskPanel dpnRisk={ESTIMATE} notices={{ ...NOTICES, items: [NOTICE_ITEM] }} />)
    expect(container.textContent).not.toMatch(/Reduced by later amendments|Estimated still owing|Paid, oldest debts first|Estimate from the ATO account|Removed if an SBR practitioner/)
    // "Stays with the director unless paid" survives only as the notice's own Column 5 heading.
    expect(container.querySelector('.grid')?.textContent).not.toMatch(/Stays with the director/)
  })

  it('lists the late statements one row per statement, GST and PAYG apart, with Copy and Excel', async () => {
    render(<DpnRiskPanel dpnRisk={ESTIMATE} notices={null} />)
    await userEvent.click(screen.getByRole('button', { name: /Show the 1 statement lodged more than 90 days late/ }))
    const cells = within(document.getElementById('late-statements')!.querySelector('table')!).getAllByRole('row')[1].textContent
    expect(cells).toContain('$5,000.00')
    expect(cells).toContain('$3,000.00')
    expect(cells).toContain('$8,000.00')
    expect(cells).toContain('185')
    expect(screen.getByRole('button', { name: /^Copy all:/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Download these rows \(Excel\)/ })).toBeTruthy()
  })

  it('lists each notice with its rows as printed, and a passed deadline as passed', async () => {
    render(<DpnRiskPanel dpnRisk={ESTIMATE} notices={{ ...NOTICES, items: [{ ...NOTICE_ITEM, deadline: '2026-10-22', daysLeft: -25 }] }} />)
    const list = screen.getByTestId('dpn-notices-list')
    expect(list.textContent).toContain('PAYG withholding notice')
    expect(list.textContent).toContain('Deadline passed 22 Oct 2026')
    expect(list.textContent).not.toMatch(/days left/)
    await userEvent.click(within(list).getByRole('button', { name: /Show the notice's rows/ }))
    expect(list.textContent).toContain('Column 5')
    expect(list.textContent).toContain('$29,000.00')
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
      unparsedDateRows: 0,
      analysedAt: '2026-03-02T00:00:00.000Z',
      // Verified against the ATO's own balance (src/lib/ica/view.ts).
      verification: icaViewOf({ rows, label: 'Activity statement 001', ica_status: 'verified' }),
    }
  }

  it('has the badge, the verified composition in the ATO words and the rows by line, never an unexplained line', () => {
    const csv = buildExportCsv(payload())
    expect(csv).toContain("Matches the ATO's own balance: $10,000.00 DR")
    expect(csv).toContain('DEBT COMPOSITION')
    expect(csv).toContain('ATO ROWS BY LINE')
    expect(csv).toContain('GST lodged,"$10,000.00"')
    expect(csv).not.toMatch(/unexplained/i)
    // The director penalty section as on the page.
    expect(csv).toContain('Lodged more than 90 days late since the balance was last nil,"$8,000.00",Since')
    expect(csv).toContain('LODGED MORE THAN 90 DAYS LATE')
    expect(csv).not.toMatch(/Reduced by later amendments|Estimated still owing|Paid since/i)
  })

  it('exports no composition for a file not verified against the ATO balance', () => {
    const csv = buildExportCsv({ ...payload(), verification: null })
    expect(csv).not.toContain('DEBT COMPOSITION')
    expect(csv).not.toMatch(/unexplained/i)
  })

  it("gives the notices' Unpaid, and each notice with its rows as printed", () => {
    const csv = buildExportCsv(payload(), { ...NOTICES, items: [NOTICE_ITEM] })
    expect(csv).toContain(`${NOTICES_LABEL},Unpaid,"$52,300.00"`)
    expect(csv).toContain('PAYG withholding notice')
    expect(csv).toContain('Column 5: Stays with the director unless paid')
    expect(csv).toContain('"$29,000.00"')
  })

  it('says when no notice is uploaded', () => {
    expect(buildExportCsv(payload())).toContain(`${NOTICES_LABEL},Unpaid,No director penalty notice uploaded`)
  })
})
