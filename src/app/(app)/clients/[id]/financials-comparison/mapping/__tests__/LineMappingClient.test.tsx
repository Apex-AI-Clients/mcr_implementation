import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { buildPrintedComparison, type ComparisonDocument } from '@/lib/printed/compare'
import { suggestMapping } from '@/lib/printed/dictionary'
import type { MappingEntry } from '@/lib/printed/mapping'
import type { PrintedColumn, PrintedRow, PrintedStatement } from '@/lib/printed/types'

/** "Confirm key figures". Synthetic statements only. */

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }))
const { LineMappingClient } = await import('../LineMappingClient')

const fy = (y: number): PrintedColumn => ({ header: String(y), periodStart: `${y - 1}-07-01`, periodEnd: `${y}-06-30`, kind: 'annual', financialYear: y })
const r = (path: string[], label: string, style: PrintedRow['style'], ...amounts: (number | null)[]): PrintedRow => ({ page: 1, path, label, style, amounts, text: label })
const st = (kind: PrintedStatement['kind'], rows: PrintedRow[]): PrintedStatement => ({ kind, title: kind, pages: [1], columns: [fy(2025), fy(2024)], rows, wholeDollars: true })

const doc: ComparisonDocument = {
  documentId: 'fy25',
  filename: 'fy25.pdf',
  uploadedAt: '',
  read: {
    status: 'read',
    pageCount: 2,
    issues: [],
    statements: [
      st('profit_and_loss', [
        r([], 'Income', 'heading', null, null),
        r(['Income'], 'Sales', 'line', 500, 400),
        r(['Income'], 'Total Income', 'subtotal', 500, 400),
        r([], 'Expenses', 'heading', null, null),
        r(['Expenses'], 'Wages', 'line', 300, 350),
        r(['Expenses'], 'Total Expenses', 'subtotal', 300, 350),
        r([], 'Net Profit', 'total', 200, 50),
      ]),
      st('balance_sheet', [
        r([], 'Assets', 'heading', null, null),
        r(['Assets'], 'Cash', 'line', 100, 80),
        r(['Assets'], 'Loan - Related Parties', 'line', 40, 30),
        r(['Assets'], 'Total Assets', 'subtotal', 140, 110),
        r([], 'Liabilities', 'heading', null, null),
        r(['Liabilities'], 'GST', 'line', 20, 10),
        r(['Liabilities'], 'PAYG Withholding', 'line', 5, 5),
        r(['Liabilities'], 'Total Liabilities', 'subtotal', 25, 15),
        r([], 'Net Assets', 'total', 115, 95),
      ]),
    ],
  },
}
const comparison = buildPrintedComparison([doc], { comparativeYears: true })
const suggestions = suggestMapping(comparison)
const key = (label: string) => comparison.tables.flatMap((t) => t.rows).find((x) => x.label === label)!.key

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function renderPage(mapping: MappingEntry[] = []) {
  return render(<LineMappingClient clientId="client-1" clientName="Example Pty Ltd" comparison={comparison} mapping={mapping} suggestions={suggestions} changes={[]} />)
}
const cardOf = (title: string) => screen.getByRole('listitem', { name: title })
const sentSelection = () => JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string).selection

describe('Confirm key figures', () => {
  it('confirms every suggestion at once, and nothing that has no suggestion', async () => {
    const user = userEvent.setup()
    renderPage()
    expect(screen.getByText('0 of 7 confirmed')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Confirm all suggestions' }))
    const selection = sentSelection()
    expect(selection.revenue).toEqual({ rowKeys: [key('Total Income')] })
    expect(selection.ato_debt).toEqual({ rowKeys: [key('GST'), key('PAYG Withholding')] })
    expect(selection.loan_receivable).toEqual({ rowKeys: [key('Loan - Related Parties')] })
    // No suggestion for these: left for staff.
    expect(selection.loan_payable).toBeUndefined()
    expect(selection.income_tax_payable).toBeUndefined()
    expect(refresh).toHaveBeenCalled()
  })

  it('shows the chosen line with every year and no empty heading, and the status', () => {
    renderPage([{ meaning: 'net_profit', rowKey: key('Net Profit'), label: 'Net Profit', nonePrinted: false, confirmedBy: 'Test Staff', confirmedAt: '2026-10-25T01:00:00Z' }])
    const card = cardOf('Net profit')
    // A line with no heading: "— Profit and loss", never "— ›".
    expect(within(card).getByText('— Profit and loss')).toBeTruthy()
    expect(card.textContent).not.toContain('— ›')
    expect(card.textContent).toContain('FY2024')
    expect(card.textContent).toContain('FY2025')
    expect(within(card).getByText(/Confirmed by Test Staff/)).toBeTruthy()
    expect(within(cardOf('Revenue')).getByText('Suggested')).toBeTruthy()
    expect(screen.getByText('1 of 7 confirmed')).toBeTruthy()
  })

  it('offers only plausible lines, the current one first and marked, and all lines on request', async () => {
    const user = userEvent.setup()
    renderPage()
    const card = cardOf('Net profit')
    await user.click(within(card).getByRole('button', { name: 'Choose another' }))
    const labels = within(card)
      .getAllByRole('radio')
      .map((o) => o.closest('label')!.textContent ?? '')
    expect(labels[0]).toContain('“Net Profit”')
    expect(labels[0]).toContain('current')
    expect(labels.some((l) => l.includes('Wages'))).toBe(false)
    expect(labels.at(-1)).toContain("The statements don't print this")
    await user.click(within(card).getByRole('button', { name: 'Show all lines' }))
    expect(within(card).getAllByRole('radio').some((o) => (o.closest('label')!.textContent ?? '').includes('Wages'))).toBe(true)
  })

  it('chooses one line for a single figure, and several with a running total for one made of lines', async () => {
    const user = userEvent.setup()
    renderPage()
    const revenue = cardOf('Revenue')
    await user.click(within(revenue).getByRole('button', { name: 'Choose another' }))
    expect(within(revenue).queryAllByRole('checkbox')).toHaveLength(0)
    await user.click(within(revenue).getByRole('radio', { name: /“Sales”/ }))
    await user.click(within(revenue).getByRole('button', { name: 'Use this line' }))
    expect(sentSelection()).toEqual({ revenue: { rowKeys: [key('Sales')] } })

    const ato = cardOf('ATO-related debt')
    await user.click(within(ato).getByRole('button', { name: 'Choose another' }))
    expect(within(ato).getAllByRole('checkbox').filter((c) => (c as HTMLInputElement).checked)).toHaveLength(2)
    const total = within(ato).getByText('Total of the 2 lines ticked').parentElement!
    expect(total.textContent).toContain('25')
    expect(total.textContent).toContain('15')
  })
})
