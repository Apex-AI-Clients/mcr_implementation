import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'

/** The "Scanning documents" box: plain words, per-file progress, and a way out if nothing starts. Synthetic. */

const refresh = vi.fn()
const router = { refresh }
vi.mock('next/navigation', () => ({ useRouter: () => router }))
const { ScanProgress } = await import('../ScanFigures')

let jobs: unknown[] = []
let stopped: unknown[] = []
const fetchMock = vi.fn(async (url: string) => new Response(JSON.stringify(url.includes('scan-jobs') ? { jobs, stopped } : { started: 1 }), { status: 200 }))
beforeEach(() => {
  jobs = []
  stopped = []
  refresh.mockClear()
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const files = [
  { documentId: 'd1', filename: '2023 - Financial Statements.pdf' },
  { documentId: 'd2', filename: '2024 - Financial Statements.pdf' },
]

describe('ScanProgress', () => {
  it('says what is happening, file by file, and starts the scanning once', async () => {
    jobs = [{ id: 'j1', documentId: 'd1', stage: 'selecting', done: 11, total: 25 }]
    render(<ScanProgress clientId="c1" files={files} pollMs={20} />)
    expect(screen.getByText('Reading your scanned statements')).toBeTruthy()
    expect(screen.getByText(/It keeps going in the background: you can leave this page and come back/)).toBeTruthy()
    await waitFor(() => expect(screen.getByText('Finding the statement pages (page 12 of 25)')).toBeTruthy())
    // The second file waits for the first.
    expect(screen.getByText('Waiting its turn')).toBeTruthy()
    // No time estimate: only what is happening.
    expect(screen.queryByText(/left$/)).toBeNull()
    expect(screen.getByText('In progress')).toBeTruthy()
    expect(fetchMock.mock.calls.filter(([u]) => String(u).includes('scan-read'))).toHaveLength(1)
  })

  it('shows the second step once the statement pages are found', async () => {
    jobs = [{ id: 'j1', documentId: 'd1', stage: 'reading', done: 2, total: 5 }]
    render(<ScanProgress clientId="c1" files={files.slice(0, 1)} pollMs={20} />)
    await waitFor(() => expect(screen.getByText('Reading the figures (page 3 of 5)')).toBeTruthy())
    expect(screen.getByText('52%')).toBeTruthy()
  })

  it('says it is done, then refreshes, when every file has been read', async () => {
    jobs = [{ id: 'j1', documentId: 'd1', stage: 'reading', done: 4, total: 5 }]
    render(<ScanProgress clientId="c1" files={files.slice(0, 1)} pollMs={20} />)
    await waitFor(() => expect(screen.getByText(/Reading the figures/)).toBeTruthy())
    jobs = []
    await waitFor(() => expect(screen.getByText('Done — updating the figures…')).toBeTruthy())
    expect(refresh).toHaveBeenCalled()
  })

  it('offers "Start scanning" when nothing has started after a while', async () => {
    render(<ScanProgress clientId="c1" files={files} pollMs={20} graceMs={60} />)
    await waitFor(() => expect(screen.getByText('Scanning has not started')).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Start scanning' })).toBeTruthy()
  })

  it('says why a reading stopped, and offers to try again', async () => {
    jobs = [{ id: 'j1', documentId: 'd1', stage: 'starting', done: 0, total: 0 }]
    render(<ScanProgress clientId="c1" files={files.slice(0, 1)} pollMs={20} />)
    await waitFor(() => expect(screen.getByText('Starting…')).toBeTruthy())
    jobs = []
    stopped = [{ documentId: 'd1', message: 'The page reader (Tesseract) did not start.', finishedAt: new Date().toISOString() }]
    await waitFor(() => expect(screen.getByText('Scanning stopped before it finished')).toBeTruthy())
    expect(screen.getByText(/The page reader \(Tesseract\) did not start\./)).toBeTruthy()
    expect(screen.getByText('2023 - Financial Statements.pdf')).toBeTruthy()
    // Not "done": nothing was read.
    expect(screen.queryByText('Done — updating the figures…')).toBeNull()
    expect(refresh).not.toHaveBeenCalled()
    screen.getByRole('button', { name: 'Try again' }).click()
    await waitFor(() => expect(fetchMock.mock.calls.filter(([u]) => String(u).includes('scan-read'))).toHaveLength(2))
  })

  it('ignores a reading that stopped before this page started one', async () => {
    stopped = [{ documentId: 'd1', message: 'Stopped before it finished.', finishedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString() }]
    render(<ScanProgress clientId="c1" files={files.slice(0, 1)} pollMs={20} graceMs={60} />)
    await waitFor(() => expect(screen.getByText('Scanning has not started')).toBeTruthy())
    expect(screen.queryByText('Scanning stopped before it finished')).toBeNull()
  })

  it('shows nothing when no file is waiting', () => {
    const { container } = render(<ScanProgress clientId="c1" files={[]} />)
    expect(container.textContent).toBe('')
  })
})

