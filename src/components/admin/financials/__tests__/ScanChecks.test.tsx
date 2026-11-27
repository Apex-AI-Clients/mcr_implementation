import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ComparisonCell, PrintedComparison } from '@/lib/printed/compare'
import type { ScanCellStatus } from '@/lib/printed/types'

/** Each year's proof, and the scanned figures the two readings disagree on, with the staff choice. Synthetic. */

const refresh = vi.fn()
const router = { refresh }
vi.mock('next/navigation', () => ({ useRouter: () => router }))
vi.resetModules()
const { ScanChecksPanel } = await import('../ScanFigures')
const { PeriodSources } = await import('../PeriodSources')

const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
beforeEach(() => {
  refresh.mockClear()
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
  // The crop is fetched as an image; never needed here.
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const cell = (scan: ScanCellStatus, claude: number | null, ocr: number | null): ComparisonCell => ({
  printed: true,
  value: claude,
  source: { documentId: 'd1', filename: 'fy25.pdf', page: 2, text: 'Rent', header: '2025' },
  restated: [],
  check: null,
  scan: { status: scan, claude, ocr, key: 'rent', documentId: 'd1', page: 2, band: [10, 20], column: 0 },
})

const comparison = (c: ComparisonCell): PrintedComparison => ({
  columns: [{ key: 'FY2025', kind: 'annual', financialYear: 2025, periodStart: '2024-07-01', periodEnd: '2025-06-30' }],
  tables: [{ kind: 'profit_and_loss', title: 'Profit & Loss', rows: [{ key: 'rent', path: [], label: 'Rent', style: 'line', cells: [c] }] }],
  failures: [],
  documents: [{ documentId: 'd1', filename: 'fy25.pdf', status: 'read', found: null, used: true, message: null, issues: [] }],
  annualYears: 1,
  hiddenComparativeYears: [],
  periodSources: [],
})

describe('scanned figures to check', () => {
  it('a year whose readings agree shows the badge, and nothing to check', () => {
    render(
      <>
        <PeriodSources clientId="c1" comparison={comparison(cell('agree', 9600, 9600))} defaultOpen />
        <ScanChecksPanel clientId="c1" comparison={comparison(cell('agree', 9600, 9600))} />
      </>,
    )
    expect(screen.getByTestId('year-proofs').textContent).toContain('Every total on the statements adds up')
    expect(screen.queryByTestId('scan-checks')).toBeNull()
  })

  it('a disagreement holds the year and offers both readings; choosing one saves it', async () => {
    const c = comparison(cell('disagree', 9999, 9600))
    render(
      <>
        <PeriodSources clientId="c1" comparison={c} defaultOpen />
        <ScanChecksPanel clientId="c1" comparison={c} />
      </>,
    )
    expect(screen.getByTestId('year-proofs').textContent).toContain('Being prepared')
    const chooser = within(screen.getByTestId('scan-checks')).getByTestId('scan-chooser')
    expect(chooser.textContent).toContain('9,999')
    expect(chooser.textContent).toContain('9,600')
    fireEvent.click(within(chooser).getAllByRole('button', { name: 'Use this' })[1])
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    const body = JSON.parse(((fetchMock.mock.calls as unknown as [string, RequestInit][]).find(([u]) => u.includes('scan-choices'))![1].body as string))
    expect(body).toEqual({ documentId: 'd1', rowKey: 'rent', column: 0, source: 'tesseract', value: 9600 })
  })
})
