import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'

/** The "Reading the uploaded files" banner: follows the run, and never spins on when its checks go unanswered. Synthetic. */

const refresh = vi.fn()
const router = { refresh }
vi.mock('next/navigation', () => ({ useRouter: () => router }))
// A fresh copy: another test file's router mock must never be the one it calls.
vi.resetModules()
const { ComparisonJobStatus } = await import('../ComparisonJobStatus')

afterEach(() => {
  cleanup()
  refresh.mockClear()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const tick = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(4000)
  })
}

const props = { clientId: 'c1', jobId: 'j1', startedAt: new Date().toISOString() }

describe('ComparisonJobStatus', () => {
  it('says the files have been read, and refreshes, once the run is done', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status: 'done' }), { status: 200 })))
    render(<ComparisonJobStatus {...props} />)
    expect(screen.getByText('Reading the uploaded files.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open comparison' }).getAttribute('href')).toBe('/clients/c1/financials-comparison')
    await tick()
    expect(screen.getByText('The uploaded files have been read.')).toBeTruthy()
    expect(refresh).toHaveBeenCalled()
  })

  it('stops saying "Reading…" when its checks go unanswered, and offers a reload', async () => {
    vi.useFakeTimers()
    // An error page instead of the status: not JSON.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>error</html>', { status: 200 })))
    render(<ComparisonJobStatus {...props} />)
    await tick()
    await tick()
    expect(screen.getByText('Reading the uploaded files.')).toBeTruthy()
    await tick()
    expect(screen.queryByText('Reading the uploaded files.')).toBeNull()
    expect(screen.getByText('Could not check on the reading of the uploaded files.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy()
  })

  it('keeps following the run through one dropped check', async () => {
    vi.useFakeTimers()
    let n = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => (++n === 1 ? new Response('oops', { status: 200 }) : new Response(JSON.stringify({ status: n >= 3 ? 'done' : 'processing' }), { status: 200 }))),
    )
    render(<ComparisonJobStatus {...props} />)
    await tick()
    await tick()
    expect(screen.getByText('Reading the uploaded files.')).toBeTruthy()
    await tick()
    expect(screen.getByText('The uploaded files have been read.')).toBeTruthy()
  })
})
