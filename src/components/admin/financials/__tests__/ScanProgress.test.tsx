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
    expect(screen.getByText('Scanning 2 documents')).toBeTruthy()
    await waitFor(() => expect(screen.getByText('Finding the statement pages (page 12 of 25)')).toBeTruthy())
    expect(screen.getByText('Starting…')).toBeTruthy()
    expect(fetchMock.mock.calls.filter(([u]) => String(u).includes('scan-read'))).toHaveLength(1)
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
