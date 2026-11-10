import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'

/** The "Scanning documents" box: plain words, per-file progress, and a way out if nothing starts. Synthetic. */

const refresh = vi.fn()
const router = { refresh }
vi.mock('next/navigation', () => ({ useRouter: () => router }))
const { ScanProgress } = await import('../ScanFigures')

let jobs: unknown[] = []
const fetchMock = vi.fn(async (url: string) => new Response(JSON.stringify(url.includes('scan-jobs') ? { jobs } : { started: 1 }), { status: 200 }))
beforeEach(() => {
  jobs = []
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
    expect(screen.getByText(/minutes? left$/)).toBeTruthy()
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

  it('shows nothing when no file is waiting', () => {
    const { container } = render(<ScanProgress clientId="c1" files={[]} />)
    expect(container.textContent).toBe('')
  })
})

describe('timeLeft', () => {
  it('says how long, in words', async () => {
    const { timeLeft } = await import('../ScanFigures')
    expect(timeLeft(30)).toBe('Less than a minute left')
    expect(timeLeft(70)).toBe('About a minute left')
    expect(timeLeft(250)).toBe('About 4 minutes left')
  })
})
