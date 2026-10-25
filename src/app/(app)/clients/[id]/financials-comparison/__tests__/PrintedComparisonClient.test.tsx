import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { buildPrintedComparison, type ComparisonDocument } from '@/lib/printed/compare'
import { MEANINGS } from '@/lib/printed/meanings'
import { suggestMapping, type Suggestions } from '@/lib/printed/dictionary'
import type { MappingEntry } from '@/lib/printed/mapping'
import type { PrintedColumn, PrintedRow, PrintedStatement } from '@/lib/printed/types'

/** The as-printed comparison page. Synthetic reports only. */

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))

const { PrintedComparisonClient } = await import('../PrintedComparisonClient')

afterEach(cleanup)

const NO_SUGGESTIONS = Object.fromEntries(MEANINGS.map((m) => [m.key, []])) as unknown as Suggestions

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
  ], { comparativeYears: true })
}

function renderPage(c = comparison()) {
  return render(<PrintedComparisonClient clientId="client-1" clientName="Example Pty Ltd" comparison={c} builtAt="2026-10-24T00:00:00.000Z" initialFiguresChecked={null} mapping={[]} suggestions={NO_SUGGESTIONS} />)
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

  it('shows a suggested tile with "Suggested — check", which opens the picker and saves the mapping', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const c = comparison()
    render(
      <PrintedComparisonClient clientId="client-1" clientName="Example Pty Ltd" comparison={c} builtAt={null} initialFiguresChecked={null} mapping={[]} suggestions={suggestMapping(c)} />,
    )
    const tile = screen.getByText('Loan account — owed TO the company').parentElement!
    // The suggested line's figure, with the prompt to check it.
    expect(tile.textContent).toContain('50')
    await user.click(within(tile).getByRole('button', { name: 'Suggested — check' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('checkbox', { name: /“Loan - Director”.*current/ })).toBeTruthy()
    await user.click(within(dialog).getByRole('button', { name: 'Use this line' }))
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/clients/client-1/line-mapping', expect.objectContaining({ method: 'PUT' }))
    vi.unstubAllGlobals()
  })

  it('shows the review bar, and each tile marked by its state, until the key figures are confirmed', () => {
    const c = comparison()
    const suggestions = suggestMapping(c)
    const page = (mapping: MappingEntry[]) =>
      render(<PrintedComparisonClient clientId="client-1" clientName="Example Pty Ltd" comparison={c} builtAt={null} initialFiguresChecked={null} mapping={mapping} suggestions={suggestions} />)
    page([])
    const bar = screen.getByRole('status', { name: 'Key figures to review' })
    expect(bar.textContent).toContain('0/7')
    expect(within(bar).getByRole('link', { name: /Review key figures/ }).getAttribute('href')).toBe('/clients/client-1/financials-comparison/mapping')
    const loanTile = screen.getByText('Loan account — owed TO the company').closest('[data-status]')!
    expect(loanTile.getAttribute('data-status')).toBe('suggested')
    expect(screen.getByText('Loan account — owed BY the company').closest('[data-status]')!.getAttribute('data-status')).toBe('not_found')
    cleanup()

    // Every key figure confirmed: the bar gives way to a green pill.
    const at = '2026-10-25T00:00:00Z'
    const all: MappingEntry[] = MEANINGS.filter((m) => m.required).map((m) => ({ meaning: m.key, rowKey: '', label: null, nonePrinted: true, confirmedBy: 'Test Staff', confirmedAt: at }))
    page(all)
    expect(screen.queryByRole('status', { name: 'Key figures to review' })).toBeNull()
    expect(screen.getByRole('link', { name: /All key figures confirmed/ })).toBeTruthy()
    expect(screen.getByText('Revenue').closest('[data-status]')!.getAttribute('data-status')).toBe('confirmed')
  })

  it('opens the exports when every printed total adds up', () => {
    renderPage()
    expect(screen.queryByText(/Needs review/)).toBeNull()
    expect((screen.getByRole('button', { name: /Export CSV/ }) as HTMLButtonElement).disabled).toBe(false)
  })
})
