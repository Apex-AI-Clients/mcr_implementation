import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { buildPrintedComparison, type ComparisonDocument, type SourceChoice } from '@/lib/printed/compare'
import type { PrintedColumn, PrintedRow, PrintedStatement } from '@/lib/printed/types'

/** Each period's badges, source, "Also in", and the source choices (Gabby, 25 Nov 2026). Synthetic. */

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
vi.resetModules()
const { PeriodSources } = await import('../PeriodSources')

const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
beforeEach(() => {
  fetchMock.mockClear()
  refresh.mockClear()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const annual = (fy: number): PrintedColumn => ({ header: String(fy), periodStart: `${fy - 1}-07-01`, periodEnd: `${fy}-06-30`, kind: 'annual', financialYear: fy })
const r = (path: string[], label: string, style: PrintedRow['style'], amounts: number[]): PrintedRow => ({ page: 1, path, label, style, amounts, text: label })
const pl = (columns: PrintedColumn[], profit: number[]): PrintedStatement => ({
  kind: 'profit_and_loss',
  title: 'Profit and Loss',
  pages: [1],
  columns,
  rows: [r(['Income'], 'Sales', 'line', profit), r(['Income'], 'Total Income', 'subtotal', profit), r([], 'Net Profit', 'total', profit)],
  wholeDollars: true,
})
const bs = (columns: PrintedColumn[], earnings: number[]): PrintedStatement => ({
  kind: 'balance_sheet',
  title: 'Balance Sheet',
  pages: [1],
  columns: columns.map((c) => ({ ...c, periodStart: null })),
  rows: [r(['Equity'], 'Current Year Earnings', 'line', earnings), r(['Equity'], 'Total Equity', 'subtotal', earnings)],
  wholeDollars: true,
})
const doc = (id: string, kind: 'export' | 'annual_statements', ...statements: PrintedStatement[]): ComparisonDocument => ({
  documentId: id,
  filename: `${id}.pdf`,
  uploadedAt: '2026-11-20',
  read: { status: 'read', pageCount: 1, statements, issues: [], report: { kind, markers: kind === 'export' ? [] : ['Contents page (page 1)'] } },
})

describe('PeriodSources', () => {
  it('shows the badges, the source, and an "Also in" that differs, with its lines and "Use this source instead"', async () => {
    const comparison = buildPrintedComparison([
      doc('fs26', 'annual_statements', pl([annual(2026)], [100]), bs([annual(2026)], [100])),
      doc('xpl', 'export', pl([annual(2026), annual(2025)], [90, 50])),
    ])
    render(<PeriodSources clientId="c1" comparison={comparison} />)
    const fy26 = screen.getByTestId('year-proofs').querySelector('[data-period="FY2026"]') as HTMLElement
    expect(fy26.textContent).toContain('Every total on the statements adds up')
    expect(fy26.textContent).toContain('Profit and loss agrees with balance sheet')
    expect(within(fy26).getByTestId('period-source').textContent).toBe('Source: Annual financial statements — “fs26.pdf”')
    const also = within(fy26).getByTestId('also-in')
    expect(also.textContent).toContain('Also in: Multi-year export (2026–2025) — “xpl.pdf” — ⚠ differs on 3 lines')
    fireEvent.click(within(also).getByRole('button', { name: 'view' }))
    expect(within(also).getByRole('table').textContent).toContain('Net Profit')
    fireEvent.click(within(also).getByRole('button', { name: 'Use this source instead' }))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/clients/c1/comparison-sources', expect.objectContaining({ method: 'POST' }))
    expect(JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({ column: 'FY2026', statement: 'profit_and_loss', documentId: 'xpl' })
  })

  it('a failed check across two files offers "Use the same source for both"; a staff choice says who and offers going back', async () => {
    const choice: SourceChoice = { column: 'FY2026', statement: 'profit_and_loss', documentId: 'xpl', chosenBy: 'Jane Example', chosenAt: '2026-11-25T01:00:00Z' }
    const comparison = buildPrintedComparison(
      [doc('fs26', 'annual_statements', pl([annual(2026)], [100]), bs([annual(2026)], [100])), doc('xpl', 'export', pl([annual(2026), annual(2025)], [90, 50]))],
      { sourceChoices: [choice] },
    )
    render(<PeriodSources clientId="c1" comparison={comparison} />)
    const fy26 = screen.getByTestId('year-proofs').querySelector('[data-period="FY2026"]') as HTMLElement
    expect(fy26.getAttribute('data-status')).toBe('printed_error')
    expect(within(fy26).getByTestId('printed-total-notes').textContent).toContain('They come from different files')
    expect(fy26.textContent).toContain('Source: Multi-year export (2026–2025) — “xpl.pdf” (chosen by Jane Example on')
    fireEvent.click(within(fy26).getByRole('button', { name: 'Use the same source for both: Annual financial statements — “fs26.pdf”' }))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({ column: 'FY2026', statement: 'both', documentId: 'fs26' })
    expect(within(fy26).getByRole('button', { name: 'Back to the automatic choice' })).toBeTruthy()
  })
})
