import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, within, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StatementCoverageTable } from '../StatementCoverageTable'
import { ComparisonChecksPanel } from '../ComparisonChecksPanel'
import type { StatementCoverage } from '@/lib/financials/coverage'
import type { FinancialCheck } from '@/lib/financials/types'

/** The coverage table and the checks panel. Synthetic data only. */

afterEach(() => cleanup())

const coverage: StatementCoverage = {
  columns: [
    { key: 'fy2021', label: 'FY2021', financialYear: 2021, kind: 'annual', extra: true },
    { key: 'fy2024', label: 'FY2024', financialYear: 2024, kind: 'annual', extra: false },
    { key: 'fy2025', label: 'FY2025', financialYear: 2025, kind: 'annual', extra: false },
    {
      key: 'current',
      label: 'Current period',
      financialYear: 2026,
      kind: 'current_period',
      extra: false,
      periodLabel: '1 July 2025 to 4 May 2026',
    },
  ],
  rows: {
    income_statement: [
      { status: 'own', filename: 'old.pdf', documentId: 'd0' },
      { status: 'comparative', filename: 'combined-2025.pdf', documentId: 'd1' },
      { status: 'own', filename: '2024-2025_PROFIT_AND_LOSS.pdf', documentId: 'd2' },
      { status: 'own', filename: 'ytd.pdf', documentId: 'd3' },
    ],
    balance_sheet: [
      { status: 'own', filename: 'old.pdf', documentId: 'd0' },
      { status: 'missing', filename: null, documentId: null },
      { status: 'own', filename: 'combined-2025.pdf', documentId: 'd1' },
      { status: 'missing', filename: null, documentId: null },
    ],
  },
}

describe('StatementCoverageTable', () => {
  it('shows each statement per year, with the file on hover', () => {
    render(<StatementCoverageTable coverage={coverage} />)
    const pnl = screen.getByRole('row', { name: /Profit & Loss/ })
    const cells = within(pnl).getAllByRole('cell')
    expect(cells.map((c) => c.textContent?.split(':')[0])).toEqual(['Own file', 'Comparative', 'Own file', 'Own file'])
    expect(cells[1].getAttribute('title')).toBe('From the prior-year column of combined-2025.pdf')
    expect(cells[2].getAttribute('title')).toBe('2024-2025_PROFIT_AND_LOSS.pdf')

    const bs = within(screen.getByRole('row', { name: /Balance Sheet/ })).getAllByRole('cell')
    expect(bs[1].textContent).toBe('Missing')
    expect(bs[1].getAttribute('title')).toBeNull()
  })

  it('labels older years and the current period', () => {
    render(<StatementCoverageTable coverage={coverage} />)
    // The accessible-name helper trims each text node, so the space before
    // "(older)" — present in the markup — does not show up here.
    expect(screen.getByRole('columnheader', { name: /FY2021\s*\(older\)/ })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: /Current period.*4 May 2026/ })).toBeTruthy()
  })

  it('renders nothing with no statements', () => {
    const { container } = render(
      <StatementCoverageTable coverage={{ columns: [], rows: { income_statement: [], balance_sheet: [] } }} />,
    )
    expect(container.textContent).toBe('')
  })
})

const checks: FinancialCheck[] = [
  {
    kind: 'restatement',
    severity: 'warning',
    financialYear: 2024,
    statement: 'balance_sheet',
    message: 'FY2024 differs between its own file and the comparative.',
    documentIds: ['d1'],
  },
  {
    kind: 'retained_earnings_rollforward',
    severity: 'info',
    financialYear: 2025,
    statement: 'balance_sheet',
    message: 'Implies dividends of $40,000.',
    documentIds: [],
  },
  {
    kind: 'not_statements',
    severity: 'warning',
    financialYear: null,
    statement: null,
    message: 'deed.pdf: does not look like financial statements.',
    documentIds: ['d9'],
  },
  {
    kind: 'totals_reconciliation',
    severity: 'warning',
    financialYear: 2026,
    statement: 'income_statement',
    currentPeriod: true,
    message: 'Current period P&L does not add up.',
    documentIds: [],
  },
]

describe('ComparisonChecksPanel', () => {
  it('opens on a warning and groups checks by year and statement', () => {
    render(<ComparisonChecksPanel checks={checks} />)
    expect(screen.getByRole('button', { name: /Statement checks 3 warnings · 1 note/ }).getAttribute('aria-expanded')).toBe('true')
    const headings = screen.getAllByText(/^(Documents|FY\d{4} · .+|Current period · .+)$/).map((el) => el.textContent)
    expect(headings).toEqual([
      'Documents',
      'FY2024 · Balance Sheet',
      'FY2025 · Balance Sheet',
      'Current period · Profit & Loss',
    ])
  })

  it('starts closed when there are only notes, and toggles', async () => {
    const user = userEvent.setup()
    render(<ComparisonChecksPanel checks={[checks[1]]} />)
    const toggle = screen.getByRole('button', { name: /Statement checks 1 note/ })
    expect(screen.queryByText('Implies dividends of $40,000.')).toBeNull()
    await user.click(toggle)
    expect(screen.getByText('Implies dividends of $40,000.')).toBeTruthy()
  })

  it('renders nothing with no checks', () => {
    const { container } = render(<ComparisonChecksPanel checks={[]} />)
    expect(container.textContent).toBe('')
  })
})
