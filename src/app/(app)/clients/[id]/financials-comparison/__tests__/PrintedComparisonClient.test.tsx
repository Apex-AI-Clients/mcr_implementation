import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { buildPrintedComparison, type ComparisonDocument } from '@/lib/printed/compare'
import { suggestMapping } from '@/lib/printed/dictionary'
import type { MappingEntry } from '@/lib/printed/mapping'
import type { PrintedColumn, PrintedRow, PrintedStatement } from '@/lib/printed/types'
import type { IcaHeadline } from '@/lib/printed/headline'

/** The comparison page: headline figures only (Gabby, 16 Nov 2026). Synthetic reports only. */

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))

const { PrintedComparisonClient } = await import('../PrintedComparisonClient')

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const fy = (y: number): PrintedColumn => ({ header: String(y), periodStart: `${y - 1}-07-01`, periodEnd: `${y}-06-30`, kind: 'annual', financialYear: y })
const current: PrintedColumn = { header: '30 Sep 2025', periodStart: '2025-07-01', periodEnd: '2025-09-30', kind: 'current_period', financialYear: 2026 }
const r = (path: string[], label: string, style: PrintedRow['style'], ...amounts: (number | null)[]): PrintedRow => ({
  page: 2,
  path,
  label,
  style,
  amounts,
  text: `${label} ${amounts.map((a) => a ?? '-').join(' ')}`,
})
const bs = (cols: PrintedColumn[], rows: PrintedRow[]): PrintedStatement => ({ kind: 'balance_sheet', title: 'Balance Sheet', pages: [2], columns: cols, rows, wholeDollars: true })
const pl = (cols: PrintedColumn[], rows: PrintedRow[]): PrintedStatement => ({ kind: 'profit_and_loss', title: 'Profit and Loss', pages: [1], columns: cols, rows, wholeDollars: true })
const doc = (id: string, statements: PrintedStatement[]): ComparisonDocument => ({ documentId: id, filename: `${id}.pdf`, uploadedAt: id, read: { status: 'read', pageCount: 3, statements, issues: [] } })

const sheet = (cols: PrintedColumn[], v: (a: number) => number[]) =>
  bs(cols, [
    r([], 'Assets', 'heading', ...cols.map(() => null)),
    r(['Assets', 'Current Assets'], 'Cash at Bank', 'line', ...v(1000)),
    r(['Assets', 'Current Assets'], 'Loan - Director', 'line', ...v(50)),
    r(['Assets', 'Current Assets'], 'Total Current Assets', 'subtotal', ...v(1050)),
    r(['Assets', 'Non-Current Assets'], 'Plant and Equipment', 'line', ...v(400)),
    r(['Assets', 'Non-Current Assets'], 'Total Non-Current Assets', 'subtotal', ...v(400)),
    r(['Assets'], 'Total Assets', 'subtotal', ...v(1450)),
    r([], 'Liabilities', 'heading', ...cols.map(() => null)),
    r(['Liabilities', 'Current Liabilities'], 'Income Tax Payable', 'line', ...v(70)),
  ])

function comparison() {
  return buildPrintedComparison([
    doc('fy2024', [pl([fy(2024)], [r([], 'Sales', 'line', 900), r([], 'Net Profit', 'total', 90)]), sheet([fy(2024)], (a) => [a - 100 > 0 ? a - 100 : a])]),
    doc('fy2025', [pl([fy(2025)], [r([], 'Sales', 'line', 1000), r([], 'Net Profit', 'total', 120)]), sheet([fy(2025)], (a) => [a])]),
    doc('sep2025', [pl([current], [r([], 'Sales', 'line', 300), r([], 'Net Profit', 'total', 30)]), sheet([current], (a) => [a + 5])]),
  ])
}

const NO_ICA: IcaHeadline = { status: 'none', cells: [] }

function renderPage({ mapping = [] as MappingEntry[], ica = NO_ICA } = {}) {
  const c = comparison()
  return render(<PrintedComparisonClient clientId="client-1" clientName="Example Pty Ltd" comparison={c} mapping={mapping} suggestions={suggestMapping(c)} ica={ica} />)
}

describe('PrintedComparisonClient', () => {
  it('shows only the headline figures, in Gabby’s order and wording, the current period as a column beside the years', () => {
    renderPage()
    const table = within(screen.getByTestId('headline-figures')).getByRole('table')
    const heads = within(table).getAllByRole('columnheader').map((h) => h.textContent)
    expect(heads[0]).toBe('Figure')
    expect(heads.slice(1).map((h) => h?.slice(0, 6))).toEqual(['FY2024', 'FY2025', 'Curren'])
    const rows = within(table).getAllByRole('rowheader').map((h) => h.textContent ?? '')
    const labels = [
      'Director loan account (Debit)',
      'Loan account director (Credit)',
      'Net profit',
      'ATO related debt – ICA',
      'ATO related debt – Income tax payable',
      'Total current assets',
      'Total non-current assets',
      'Total assets',
    ]
    labels.forEach((l, i) => expect(rows[i].startsWith(l)).toBe(true))
    expect(rows).toHaveLength(8)
    // Nothing else: no detailed tables, no revenue, no net assets, no summary.
    expect(screen.getAllByRole('table')).toHaveLength(1)
    expect(screen.queryByText('Cash at Bank')).toBeNull()
    expect(screen.queryByText(/^Revenue$/)).toBeNull()
    expect(screen.queryByText(/Net assets/)).toBeNull()
    expect(screen.queryByText(/Summary/)).toBeNull()
  })

  it('fills each row from its printed line, every year, and the current period too', () => {
    renderPage()
    const row = (key: string) => document.querySelector(`tr[data-row="${key}"]`) as HTMLElement
    const cells = (key: string) => within(row(key)).getAllByRole('cell').map((c) => c.textContent)
    expect(cells('total_assets')).toEqual(['1,350', '1,450', '1,455'])
    expect(cells('total_current_assets')).toEqual(['950', '1,050', '1,055'])
    expect(cells('total_non_current_assets')).toEqual(['300', '400', '405'])
    expect(cells('net_profit')).toEqual(['90', '120', '30'])
    expect(cells('income_tax_payable')).toEqual(['70', '70', '75'].map((v, i) => (i === 0 ? '70' : v)))
  })

  it('each figure says where it is printed and can copy the line', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderPage()
    const totals = document.querySelector('tr[data-row="total_assets"]') as HTMLElement
    await user.click(within(totals).getByRole('button', { name: 'Where 1,450 comes from' }))
    const panel = screen.getByRole('dialog', { name: 'Where 1,450 comes from' })
    expect(panel.textContent).toContain('page 2 of fy2025.pdf')
    await user.click(within(panel).getByRole('button', { name: 'Copy this line' }))
    expect(writeText).toHaveBeenCalledWith('Total Assets 1450')
  })

  it('the ICA row: the ATO balance at each period end when verified, "Being prepared" when not, a dash without an account', () => {
    const balances = [{ label: 'Activity statement 001', documentId: 'ica', filename: 'ica.csv', cents: 1234500, day: '2024-06-28', row: { rawProcessed: '28 Jun 2024', description: 'Payment received', rawBalance: '$12,345.00 DR' } }]
    const ica: IcaHeadline = {
      status: 'ok',
      cells: [{ cell: { value: 12345, date: '2024-06-30', balances } }, { none: 'Activity statement 001: no balance' }, { cell: { value: 20000, date: '2025-09-30', balances: [{ ...balances[0], cents: 2000000 }] } }],
    }
    renderPage({ ica })
    const row = () => document.querySelector('tr[data-row="ica"]') as HTMLElement
    expect(within(row()).getAllByRole('cell').map((c) => c.textContent)).toEqual(['$12,345.00 DR', '—', '$20,000.00 DR'])
    cleanup()
    renderPage({ ica: { status: 'held', cells: [] } })
    expect(within(row()).getAllByRole('cell').map((c) => c.textContent)).toEqual(['Being prepared', 'Being prepared', 'Being prepared'])
    cleanup()
    renderPage()
    expect(within(row()).getAllByRole('cell').map((c) => c.textContent)).toEqual(['—', '—', '—'])
  })

  it('a suggested line is marked and opens the choice; "Confirm key figures" is always there', async () => {
    const user = userEvent.setup()
    renderPage()
    expect(screen.getByRole('link', { name: /Confirm key figures/ }).getAttribute('href')).toBe('/clients/client-1/financials-comparison/mapping')
    const loan = document.querySelector('tr[data-row="loan_receivable"]') as HTMLElement
    expect(loan.getAttribute('data-status')).toBe('suggested')
    await user.click(within(loan).getByRole('button', { name: /check it/ }))
    expect(within(screen.getByRole('dialog')).getByText('Check this key figure')).toBeTruthy()
  })
})
