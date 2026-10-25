import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, within, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReadinessChecklist } from '../ReadinessChecklist'
import { PredictOutcomeButton } from '../PredictOutcomeButton'
import type { Readiness, ReadinessItem } from '@/lib/sbr/readiness'

/** The readiness checklist and the Predict button. Synthetic data only. */

const refresh = vi.fn()
// One object, as in Next: the router is stable across renders.
const router = { refresh }
vi.mock('next/navigation', () => ({ useRouter: () => router }))

const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset()
  refresh.mockClear()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function item(over: Partial<ReadinessItem>): ReadinessItem {
  return {
    key: 'financials',
    label: 'Financial statements',
    status: 'ready',
    detail: null,
    canRunNow: false,
    href: '/clients/c1/financials-comparison',
    ...over,
  }
}

function readiness(items: ReadinessItem[], canPredict = false): Readiness {
  return { items, canPredict, waitingFor: [], dpn: null }
}

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })

/** The status check answers with `now`, every time it is asked. */
function serverSays(now: Readiness) {
  fetchMock.mockImplementation(async () => json(now))
}

const readinessCalls = () => fetchMock.mock.calls.filter(([url]) => url === '/api/admin/clients/c1/readiness')

describe('ReadinessChecklist', () => {
  it('shows each item with its status only: no review button, no list of things to check', async () => {
    const shown = readiness([
      item({}),
      item({ key: 'lodgement', label: 'ATO activity statement', status: 'failed', detail: null, href: '/clients/c1/lodgement-compliance-analysis' }),
      item({ key: 'dpn', label: 'Director penalty notices', status: 'not_uploaded', detail: 'Optional.', href: '/clients/c1' }),
    ])
    serverSays(shown)
    render(<ReadinessChecklist clientId="c1" readiness={shown} />)
    const rows = screen.getAllByRole('listitem')
    expect(within(rows[0]).getByText('Ready')).toBeTruthy()
    expect(within(rows[1]).getByText('Failed')).toBeTruthy()
    expect(within(rows[2]).getByText('Not uploaded')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /review/i })).toBeNull()
    expect(screen.queryByText(/to check/)).toBeNull()
    expect(screen.queryByText('Open')).toBeNull()
    await waitFor(() => expect(readinessCalls()).toHaveLength(1))
  })

  it('gives a Needs review item an Open button to the comparison page', () => {
    const shown = readiness([item({ status: 'needs_review', detail: 'Confirm the key figures on the comparison page.' })])
    serverSays(shown)
    render(<ReadinessChecklist clientId="c1" readiness={shown} />)
    expect(screen.getByText('Needs review')).toBeTruthy()
    expect(screen.getByRole('link', { name: /Open/ }).getAttribute('href')).toBe('/clients/c1/financials-comparison')
  })

  it('makes the heading the link, except where it would point at this page', () => {
    const shown = readiness([item({}), item({ key: 'dpn', label: 'Director penalty notices', status: 'not_uploaded', href: '/clients/c1' })])
    serverSays(shown)
    render(<ReadinessChecklist clientId="c1" readiness={shown} />)
    expect(screen.getByRole('link', { name: 'Financial statements' }).getAttribute('href')).toBe('/clients/c1/financials-comparison')
    expect(screen.queryByRole('link', { name: 'Director penalty notices' })).toBeNull()
  })

  it('runs out-of-date work on request, then shows it processing', async () => {
    const user = userEvent.setup()
    const shown = readiness([item({ status: 'not_started', canRunNow: true })])
    const running = readiness([item({ status: 'processing' })])
    fetchMock.mockImplementation(async (url: string) =>
      url.endsWith('/analysis/run') ? json({ jobId: 'j1', started: true }) : json(readinessCalls().length > 1 ? running : shown),
    )
    render(<ReadinessChecklist clientId="c1" readiness={shown} />)
    await waitFor(() => expect(readinessCalls()).toHaveLength(1))

    await user.click(screen.getByRole('button', { name: 'Run now' }))
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/admin/clients/c1/analysis/run')).toBe(true)
    await waitFor(() => expect(screen.getByText('Processing')).toBeTruthy())
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  describe('staying current', () => {
    it('checks on arrival, and leaves the page alone when nothing has changed', async () => {
      const shown = readiness([item({})], true)
      serverSays(shown)
      render(<ReadinessChecklist clientId="c1" readiness={shown} />)
      await waitFor(() => expect(readinessCalls()).toHaveLength(1))
      expect(refresh).not.toHaveBeenCalled()
    })

    it('catches up when the page shown is an old render (back button): processing has since finished', async () => {
      // Rendered while the run was going; by the time you come back, it is done.
      const stale = readiness([item({ status: 'processing' })])
      serverSays(readiness([item({ status: 'ready' })], true))
      render(<ReadinessChecklist clientId="c1" readiness={stale} />)
      await waitFor(() => expect(screen.getByText('Ready')).toBeTruthy())
      expect(screen.queryByText('Processing')).toBeNull()
      expect(refresh).toHaveBeenCalledTimes(1)
    })

    it('follows a run until it finishes, then stops asking', async () => {
      // Only setInterval is faked, so the poll's clock is ours while fetch,
      // React and setTimeout run as normal. waitFor is not used here: it polls
      // with setInterval too, and would be driven by our ticks.
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
      const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 20)))
      // A tick that lands while the last check is still finishing is skipped,
      // by design, so tick until the condition holds.
      async function tickUntil(assertion: () => void) {
        for (let i = 0; i < 20; i++) {
          vi.advanceTimersByTime(4000)
          await settle()
          try {
            assertion()
            return
          } catch {
            // not yet
          }
        }
        assertion()
      }

      const running = readiness([item({ status: 'processing' })])
      const done = readiness([item({ status: 'ready' })], true)
      let finished = false
      fetchMock.mockImplementation(async () => json(finished ? done : running))
      render(<ReadinessChecklist clientId="c1" readiness={running} />)
      await settle()
      expect(readinessCalls()).toHaveLength(1)

      await tickUntil(() => expect(readinessCalls().length).toBeGreaterThanOrEqual(2))
      expect(screen.getByText('Processing')).toBeTruthy()
      expect(refresh).not.toHaveBeenCalled()

      finished = true
      await tickUntil(() => expect(screen.getByText('Ready')).toBeTruthy())
      expect(refresh).toHaveBeenCalledTimes(1)

      const asked = readinessCalls().length
      vi.advanceTimersByTime(20000)
      await settle()
      expect(readinessCalls()).toHaveLength(asked)
    })

    it('checks again when the browser restores the page from its back/forward cache', async () => {
      const shown = readiness([item({})], true)
      serverSays(shown)
      render(<ReadinessChecklist clientId="c1" readiness={shown} />)
      await waitFor(() => expect(readinessCalls()).toHaveLength(1))

      const restored = new Event('pageshow') as PageTransitionEvent
      Object.defineProperty(restored, 'persisted', { value: true })
      window.dispatchEvent(restored)
      await waitFor(() => expect(readinessCalls()).toHaveLength(2))
    })

    it('keeps what it shows when a check fails', async () => {
      const shown = readiness([item({ status: 'processing' })])
      fetchMock.mockRejectedValue(new Error('offline'))
      render(<ReadinessChecklist clientId="c1" readiness={shown} />)
      await waitFor(() => expect(readinessCalls()).toHaveLength(1))
      expect(screen.getByText('Processing')).toBeTruthy()
      expect(refresh).not.toHaveBeenCalled()
    })
  })
})

describe('PredictOutcomeButton', () => {
  it('is disabled, and says what it is waiting for only in the info tooltip', async () => {
    const user = userEvent.setup()
    render(<PredictOutcomeButton clientId="c1" canPredict={false} waitingFor={['Director penalty notices: not uploaded']} />)
    expect((screen.getByRole('button', { name: /Predict SBR Outcome/ }) as HTMLButtonElement).disabled).toBe(true)
    // No visible text under the button; the tooltip opens on hover or focus.
    expect(screen.queryByRole('tooltip')).toBeNull()
    await user.hover(screen.getByText(/Why is Predict SBR Outcome not available/).parentElement!)
    expect(screen.getByRole('tooltip').textContent).toBe('Waiting for:\n• Director penalty notices: not uploaded')
  })

  it('links to the prediction once ready', () => {
    render(<PredictOutcomeButton clientId="c1" canPredict waitingFor={[]} />)
    expect(screen.getByRole('link').getAttribute('href')).toBe('/clients/c1/outcome-prediction')
  })
})
