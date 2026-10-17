import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, within, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DpnPanel } from '../DpnPanel'
import type { DpnPanelData, DpnNoticeView } from '@/lib/dpn/view'
import type { StoredNotice } from '@/lib/dpn/stored'

/** The client page's DPN card and the manual-entry form. Synthetic data only. */

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }))

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

const NOTICE: StoredNotice = {
  id: 'n1',
  documentId: 'doc-1',
  source: 'parsed',
  status: 'read',
  manualReason: null,
  reviewReasons: [],
  reference: '1234567890123',
  issuedOn: '2026-09-30',
  type: 'paygw',
  companyName: 'EXAMPLE TRADING PTY LTD',
  acn: '000000019',
  directorName: 'MR JANE Q SAMPLE',
  rows: [{ periodFrom: '2025-01-01', periodTo: '2025-03-31', column2: 1_000_00, column3: 900_00, column4: 800_00, column5: 100_00 }],
  totals: { column2: 1_000_00, column3: 900_00, column4: 800_00, column5: 100_00 },
  enteredBy: null,
  enteredAt: null,
}

function view(overrides: Partial<DpnNoticeView> = {}): DpnNoticeView {
  return { documentId: 'doc-1', filename: 'notice.pdf', notice: NOTICE, issues: [], deadline: '2026-10-21', ...overrides }
}

function data(overrides: Partial<DpnPanelData> = {}): DpnPanelData {
  return { notices: [view()], noneIssued: null, clearedNote: null, todayIso: '2026-10-17', ...overrides }
}

describe('DpnPanel', () => {
  it('summarises a read notice, with days left in red inside a week', () => {
    render(<DpnPanel clientId="client-1" data={data()} />)
    expect(screen.getByText('Read automatically')).toBeTruthy()
    expect(screen.getByText(/PAYG withholding/)).toBeTruthy()
    const daysLeft = screen.getByText('(4 days left)')
    expect(daysLeft.className).toContain('text-destructive')
    expect(screen.getByText('$900.00')).toBeTruthy()
  })

  it('marks a manual entry as entered manually, by whom', () => {
    const notice = { ...NOTICE, source: 'manual' as const, enteredBy: 'Sam', enteredAt: '2026-10-16T00:00:00Z' }
    render(<DpnPanel clientId="client-1" data={data({ notices: [view({ notice })] })} />)
    expect(screen.getByText('Entered manually')).toBeTruthy()
    expect(screen.getByText(/Entered manually by Sam/)).toBeTruthy()
    // A manual entry is never re-read.
    expect(screen.queryByRole('button', { name: 'Read again' })).toBeNull()
  })

  it('shows each warning on the notice', () => {
    const issues = ['This notice is for ACN 000 000 019, but the client file has ACN 123 456 780.']
    render(<DpnPanel clientId="client-1" data={data({ notices: [view({ issues })] })} />)
    expect(screen.getByText(issues[0])).toBeTruthy()
  })

  it('offers manual entry for a notice that could not be read', () => {
    const notice = { ...NOTICE, status: 'needs_manual' as const, manualReason: 'table_unreadable' as const }
    render(<DpnPanel clientId="client-1" data={data({ notices: [view({ notice })] })} />)
    expect(screen.getByText(/table could not be read/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Enter manually' })).toBeTruthy()
  })

  it('reads a file that has not been read yet', async () => {
    const user = userEvent.setup()
    render(<DpnPanel clientId="client-1" data={data({ notices: [view({ notice: null, deadline: null })] })} />)
    await user.click(screen.getByRole('button', { name: 'Read notice' }))
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/clients/client-1/director-penalty-notices/doc-1/read',
      { method: 'POST' },
    )
    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })

  it('offers the "none issued" tick only when there are no notices', async () => {
    const user = userEvent.setup()
    render(<DpnPanel clientId="client-1" data={data({ notices: [] })} />)
    await user.click(screen.getByRole('checkbox', { name: 'No director penalty notice has been issued' }))
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/clients/client-1/director-penalty-notices/none-issued')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ confirmed: true })
  })

  it('shows the note left when an upload cleared the tick', () => {
    render(<DpnPanel clientId="client-1" data={data({ clearedNote: 'Cleared automatically on 17 Oct 2026.' })} />)
    expect(screen.getByText('Cleared automatically on 17 Oct 2026.')).toBeTruthy()
  })
})

describe('DpnManualForm', () => {
  it('opens prefilled with what was read, and saves cents as entered manually', async () => {
    const user = userEvent.setup()
    render(<DpnPanel clientId="client-1" data={data()} />)
    await user.click(screen.getByRole('button', { name: 'Correct by hand' }))
    const dialog = await screen.findByRole('dialog')

    expect((within(dialog).getByLabelText('Our reference') as HTMLInputElement).value).toBe('1234567890123')
    const col3 = within(dialog).getByLabelText(/Row 1 Col 3/) as HTMLInputElement
    expect(col3.value).toBe('900.00')

    await user.clear(col3)
    await user.type(col3, '950')
    expect(within(dialog).getByText('3 ≠ 4 + 5')).toBeTruthy()
    await user.click(within(dialog).getByRole('button', { name: 'Save as entered manually' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/admin/clients/client-1/director-penalty-notices/doc-1')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body).rows[0]).toMatchObject({ column3: 950_00, column4: 800_00 })
  })

  it('says which row is missing an amount', async () => {
    const user = userEvent.setup()
    render(<DpnPanel clientId="client-1" data={data()} />)
    await user.click(screen.getByRole('button', { name: 'Correct by hand' }))
    const dialog = await screen.findByRole('dialog')
    await user.clear(within(dialog).getByLabelText(/Row 1 Col 2/))
    await user.click(within(dialog).getByRole('button', { name: 'Save as entered manually' }))
    expect(within(dialog).getByRole('alert').textContent).toMatch(/Row 1: enter all four amounts/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
