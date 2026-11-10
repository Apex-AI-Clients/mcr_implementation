import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, within, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }))

import { CvlClientTable } from '../CvlClientTable'
import type { CvlListPage, CvlListRow } from '@/lib/cvl/listing'

/** The CVL client list: ticking several clients and deleting them together, as on the SBR list. Synthetic data. */

afterEach(() => {
  cleanup()
  refresh.mockClear()
  vi.unstubAllGlobals()
})

const row = (n: number): CvlListRow => ({
  caseId: `case-${n}`,
  clientId: `cl_${n}`,
  name: `Sample Trading ${n}`,
  email: `owner${n}@example.com`,
  origin: 'lead',
  status: 'draft',
  formsPreparedAt: null,
  printedAt: null,
  sbrArchivedAt: null,
  sbrArchivedBy: null,
  createdAt: '2026-11-01T00:00:00Z',
  inSbr: false,
})

const list: CvlListPage = { rows: [row(1), row(2), row(3)], total: 3, page: 1, pageSize: 25, query: '' }

const renderList = (deletable = true) =>
  render(<CvlClientTable list={list} path="/cvl" rowHref={(id) => `/cvl/${id}`} deletable={deletable} empty="No CVL clients yet." />)

describe('CvlClientTable: delete several', () => {
  it('ticks clients, then moves only those to the Archive after asking', async () => {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify({ ok: true })))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup({ delay: null })
    renderList()

    expect(screen.queryByRole('button', { name: /Delete selected/ })).toBeNull()
    await user.click(screen.getByRole('checkbox', { name: 'Select Sample Trading 1' }))
    await user.click(screen.getByRole('checkbox', { name: 'Select Sample Trading 3' }))
    expect(screen.getByText('2 selected')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: /Delete selected/ }))
    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toContain('Sample Trading 1, Sample Trading 3')
    expect(dialog.textContent).toContain('Archive (CVL tab)')
    expect(fetchMock).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: 'Delete 2' }))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(fetchMock.mock.calls.map(([url]) => url).sort()).toEqual(['/api/admin/cvl/case-1/remove', '/api/admin/cvl/case-3/remove'])
  })

  it('selects every client on the page at once, and clears', async () => {
    const user = userEvent.setup({ delay: null })
    renderList()
    await user.click(screen.getByRole('checkbox', { name: 'Select all clients on this page' }))
    expect(screen.getByText('3 selected')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.queryByText(/selected$/)).toBeNull()
  })

  it('says how many could not be deleted', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response('{}', { status: url.includes('case-2') ? 500 : 200 })))
    const user = userEvent.setup({ delay: null })
    renderList()
    await user.click(screen.getByRole('checkbox', { name: 'Select all clients on this page' }))
    await user.click(screen.getByRole('button', { name: /Delete selected/ }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete 3' }))
    expect(await screen.findByText('1 of 3 could not be deleted. Please retry.')).toBeTruthy()
  })

  it('shows the status alone, with no date beside it', () => {
    render(
      <CvlClientTable
        list={{ ...list, rows: [{ ...row(1), status: 'printed', printedAt: '2026-10-20T00:00:00Z' }] }}
        path="/cvl"
        rowHref={(id) => `/cvl/${id}`}
        empty="No CVL clients yet."
      />,
    )
    const statusCell = screen.getByText('Printed').closest('td') as HTMLElement
    expect(statusCell.textContent).toBe('Printed')
  })

  it('dates each client from when it became a CVL client', () => {
    render(
      <CvlClientTable
        list={{ ...list, rows: [{ ...row(1), createdAt: '2026-10-20T00:00:00Z' }] }}
        path="/cvl"
        rowHref={(id) => `/cvl/${id}`}
        empty="No CVL clients yet."
      />,
    )
    expect(screen.getByRole('columnheader', { name: 'Became CVL client' })).toBeTruthy()
    expect(screen.queryByRole('columnheader', { name: 'Opened' })).toBeNull()
    const cells = screen.getAllByRole('cell')
    expect(cells.at(-1)!.textContent).toMatch(/20 Oct 2026/)
  })

  it('has no tick boxes where rows cannot be deleted (the SBR Archive’s "Moved to CVL")', () => {
    renderList(false)
    expect(screen.queryByRole('checkbox')).toBeNull()
  })
})

describe('CvlClientTable: ASIC extract on file', () => {
  it('marks each file: the extract date when kept, else a link to upload it on the intake page', () => {
    const withAsic: CvlListPage = { ...list, rows: [{ ...row(1), asicExtract: '2026-10-03' }, { ...row(2), asicExtract: null }, { ...row(3), asicExtract: '' }] }
    render(<CvlClientTable list={withAsic} path="/cvl" rowHref={(id) => `/cvl/${id}`} empty="No CVL clients yet." />)
    expect(screen.getByRole('columnheader', { name: 'ASIC extract' })).toBeTruthy()
    expect(screen.getByText('3 October 2026')).toBeTruthy()
    expect(screen.getByRole('link', { name: '— Not on file' }).getAttribute('href')).toBe('/cvl/cl_2/intake')
    expect(screen.getByText('On file')).toBeTruthy()
  })

  it('has no ASIC extract column when the list does not say', () => {
    renderList(false)
    expect(screen.queryByRole('columnheader', { name: 'ASIC extract' })).toBeNull()
  })
})
