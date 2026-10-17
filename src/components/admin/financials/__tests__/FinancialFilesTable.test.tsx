import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FinancialFilesTable } from '../FinancialFilesTable'
import type { FinancialFileRow } from '@/lib/financials/financialFiles'

/** The per-file list on the comparison page, and its override. Synthetic data. */

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function row(over: Partial<FinancialFileRow>): FinancialFileRow {
  return {
    documentId: 'doc-1',
    filename: 'statements.pdf',
    annualYears: [2024],
    comparativeYears: [],
    currentPeriodYear: null,
    currentPeriodLabel: null,
    usage: 'used',
    note: 'Annual, compared for FY2024.',
    override: null,
    overridePending: false,
    ...over,
  }
}

function renderTable(files: FinancialFileRow[], running = false) {
  const onReread = vi.fn()
  render(<FinancialFilesTable clientId="client-1" files={files} yearOptions={[2027, 2026, 2025, 2024]} onReread={onReread} running={running} />)
  return onReread
}

describe('FinancialFilesTable', () => {
  it('shows what each file was read as and whether it is used', () => {
    renderTable([
      row({}),
      row({
        documentId: 'doc-2',
        filename: 'ytd.pdf',
        annualYears: [],
        currentPeriodYear: 2026,
        usage: 'superseded',
        note: "Current period within FY2026, but FY2026 already has its annual statement, so this file isn't used.",
      }),
    ])
    const rows = screen.getAllByRole('row').slice(1)
    expect(within(rows[0]).getByText('Annual FY2024')).toBeTruthy()
    expect(within(rows[0]).getByText('Used')).toBeTruthy()
    expect(within(rows[1]).getByText('Current period, FY2026')).toBeTruthy()
    expect(within(rows[1]).getByText('Superseded')).toBeTruthy()
  })

  it('saves a year and type, then reads that one file again', async () => {
    const user = userEvent.setup()
    const onReread = renderTable([row({})])
    await user.click(screen.getByRole('button', { name: 'Change' }))
    await user.selectOptions(screen.getByLabelText('Type for statements.pdf'), 'annual')
    await user.selectOptions(screen.getByLabelText('Financial year for statements.pdf'), '2025')
    await user.click(screen.getByRole('button', { name: 'Save and read again' }))

    await waitFor(() => expect(onReread).toHaveBeenCalledWith(['doc-1']))
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/admin/clients/client-1/financial-statements/doc-1/period')
    expect(JSON.parse(init.body)).toEqual({ kind: 'annual', financialYear: 2025 })
  })

  it('offers to go back to the headings, and to apply an override not yet read', async () => {
    const user = userEvent.setup()
    const override = { kind: 'annual' as const, financialYear: 2025, by: 'Sam', at: '2026-10-05T00:00:00Z' }
    const onReread = renderTable([row({ override, overridePending: true })])
    expect(screen.getByText(/Set by Sam/)).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Read again' }))
    expect(onReread).toHaveBeenCalledWith(['doc-1'])

    await user.click(screen.getByRole('button', { name: 'Change' }))
    await user.click(screen.getByRole('button', { name: 'Use the headings' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ clear: true })
  })
})
