import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FilePeriodPanel } from '../FilePeriodPanel'
import type { FinancialFileRow } from '@/lib/financials/financialFiles'

/** A file picked in the "Statements on file" table: its year and type. Synthetic data. */

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset()
  refresh.mockReset()
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function row(over: Partial<FinancialFileRow> = {}): FinancialFileRow {
  return {
    documentId: 'doc-1',
    filename: 'SYNTH_statements_2026.pdf',
    annualYears: [2026],
    comparativeYears: [2025],
    currentPeriodYear: null,
    currentPeriodLabel: null,
    usage: 'used',
    note: 'Annual, compared for FY2026.',
    override: null,
    overridePending: false,
    ...over,
  }
}

function renderPanel(file: FinancialFileRow, running = false) {
  const onReread = vi.fn()
  const onClose = vi.fn()
  render(
    <FilePeriodPanel clientId="client-1" file={file} yearOptions={[2027, 2026, 2025, 2024]} running={running} onReread={onReread} onClose={onClose} />,
  )
  return { onReread, onClose }
}

describe('FilePeriodPanel', () => {
  it('shows what the headings were read as', () => {
    renderPanel(row())
    expect(screen.getByText('SYNTH_statements_2026.pdf')).toBeTruthy()
    expect(screen.getByText('Detected: FY2026 annual')).toBeTruthy()
    expect(screen.queryByText('Overridden')).toBeNull()
  })

  it('reads a current-period file as one', () => {
    renderPanel(row({ annualYears: [], comparativeYears: [], currentPeriodYear: 2027 }))
    expect(screen.getByText('Detected: FY2027 current period')).toBeTruthy()
  })

  it('changes the year and type, saves, and reads the file again', async () => {
    const user = userEvent.setup()
    const { onReread } = renderPanel(row())
    await user.click(screen.getByRole('button', { name: 'Change' }))
    await user.selectOptions(screen.getByLabelText('Type for SYNTH_statements_2026.pdf'), 'current_period')
    await user.selectOptions(screen.getByLabelText('Financial year for SYNTH_statements_2026.pdf'), '2027')
    await user.click(screen.getByRole('button', { name: 'Save and read again' }))

    await waitFor(() => expect(onReread).toHaveBeenCalledWith(['doc-1']))
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/admin/clients/client-1/financial-statements/doc-1/period')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ kind: 'current_period', financialYear: 2027 })
    expect(refresh).toHaveBeenCalled()
  })

  it('saves but waits to read again while a comparison is running', async () => {
    const user = userEvent.setup()
    const { onReread } = renderPanel(row(), true)
    await user.click(screen.getByRole('button', { name: 'Change' }))
    await user.click(screen.getByRole('button', { name: 'Save and read again' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(onReread).not.toHaveBeenCalled()
  })

  it('cancels without saving', async () => {
    const user = userEvent.setup()
    const { onReread } = renderPanel(row())
    await user.click(screen.getByRole('button', { name: 'Change' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(onReread).not.toHaveBeenCalled()
    expect(screen.getByText('Detected: FY2026 annual')).toBeTruthy()
  })

  it('shows an override, and clears it back to the headings', async () => {
    const user = userEvent.setup()
    const override = { kind: 'annual' as const, financialYear: 2025, by: 'Sam', at: '2026-10-05T00:00:00Z' }
    const { onReread } = renderPanel(row({ override }))
    expect(screen.getByText('Overridden')).toBeTruthy()
    expect(screen.getByText('Set by hand: annual, FY2025')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Change' }))
    await user.click(screen.getByRole('button', { name: 'Use the headings' }))
    await waitFor(() => expect(onReread).toHaveBeenCalledWith(['doc-1']))
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ clear: true })
  })

  it('offers to apply an override the file has not been read with yet', async () => {
    const user = userEvent.setup()
    const override = { kind: 'annual' as const, financialYear: 2025, by: null, at: null }
    const { onReread } = renderPanel(row({ override, overridePending: true }))
    await user.click(screen.getByRole('button', { name: 'Read again' }))
    expect(onReread).toHaveBeenCalledWith(['doc-1'])
  })

  it('closes', async () => {
    const user = userEvent.setup()
    const { onClose } = renderPanel(row())
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalled()
  })
})
