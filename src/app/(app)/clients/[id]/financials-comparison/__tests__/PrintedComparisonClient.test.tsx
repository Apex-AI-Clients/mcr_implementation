import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { buildPrintedComparison, type ComparisonDocument } from '@/lib/printed/compare'
import type { PrintedColumn, PrintedRow, PrintedStatement } from '@/lib/printed/types'

/** The as-printed comparison page. Synthetic reports only. */

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

const { PrintedComparisonClient } = await import('../PrintedComparisonClient')

afterEach(cleanup)

const fy = (y: number): PrintedColumn => ({ header: String(y), periodStart: `${y - 1}-07-01`, periodEnd: `${y}-06-30`, kind: 'annual', financialYear: y })
const r = (path: string[], label: string, style: PrintedRow['style'], ...amounts: (number | null)[]): PrintedRow => ({
  page: 2,
  path,
  label,
  style,
  amounts,
  text: `${label} ${amounts.map((a) => a ?? '-').join(' ')}`,
})
const bs = (cols: PrintedColumn[], rows: PrintedRow[]): PrintedStatement => ({ kind: 'balance_sheet', title: 'Balance Sheet', pages: [2], columns: cols, rows, wholeDollars: false })
const doc = (id: string, statements: PrintedStatement[]): ComparisonDocument => ({ documentId: id, filename: `${id}.pdf`, uploadedAt: id, read: { status: 'read', pageCount: 3, statements, issues: [] } })

function comparison({ broken = false } = {}) {
  return buildPrintedComparison([
    doc('fy2024', [bs([fy(2024), fy(2023)], [r([], 'Assets', 'heading', null, null), r(['Assets'], 'Cash at Bank', 'line', 1000.5, 900), r(['Assets'], 'Total Assets', 'subtotal', 1000.5, 900)])]),
    doc('fy2025', [
      bs([fy(2025), fy(2024)], [
        r([], 'Assets', 'heading', null, null),
        r(['Assets'], 'Cash at Bank', 'line', 1200, 1000.5),
        r(['Assets'], 'Loan - Director', 'line', 50, 25),
        r(['Assets'], 'Total Assets', 'subtotal', broken ? 1300 : 1250, 1025.5),
      ]),
    ]),
  ])
}

function renderPage(c = comparison()) {
  return render(<PrintedComparisonClient clientId="client-1" clientName="Example Pty Ltd" comparison={c} builtAt="2026-10-24T00:00:00.000Z" initialFiguresChecked={null} meanings={[]} />)
}

describe('PrintedComparisonClient', () => {
  it('shows each year as printed, cents kept, blank where a year does not print the line, with the restatement note', () => {
    renderPage()
    expect(screen.getByRole('columnheader', { name: /FY2023/ })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: '1,000.50' }).length).toBeGreaterThan(0)
    const loan = screen.getByText('Loan - Director').closest('tr')!
    const cells = within(loan).getAllByRole('cell')
    expect(cells[2].textContent).toBe('Restated in FY2025 report: 25')
    expect(cells[3].textContent).toBe('50')
  })

  it('shows the file, page and printed line of a clicked figure', async () => {
    const user = userEvent.setup()
    renderPage()
    const total = screen.getByText('Total Assets').closest('tr')!
    await user.click(within(total).getByRole('button', { name: '1,250' }))
    expect(screen.getByText(/fy2025\.pdf, page 2, column/)).toBeTruthy()
    expect(screen.getByText('“Total Assets 1250 1025.5”')).toBeTruthy()
  })

  it('locks the PDF and CSV behind Needs review when a printed total does not add up', () => {
    renderPage(comparison({ broken: true }))
    expect(screen.getByText(/Needs review: a figure does not reconcile/)).toBeTruthy()
    expect((screen.getByRole('button', { name: /Export CSV/ }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: /Export PDF/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('opens the exports when every printed total adds up', () => {
    renderPage()
    expect(screen.queryByText(/Needs review/)).toBeNull()
    expect((screen.getByRole('button', { name: /Export CSV/ }) as HTMLButtonElement).disabled).toBe(false)
  })
})
