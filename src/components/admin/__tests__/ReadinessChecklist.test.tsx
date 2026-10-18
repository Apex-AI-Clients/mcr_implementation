import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReadinessChecklist } from '../ReadinessChecklist'
import { PredictOutcomeButton } from '../PredictOutcomeButton'
import type { Readiness, ReadinessItem } from '@/lib/sbr/readiness'

/** The readiness checklist and the Predict button. Synthetic data only. */

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

function item(over: Partial<ReadinessItem>): ReadinessItem {
  return {
    key: 'financials',
    label: 'Financial statements',
    status: 'ready',
    detail: 'Compared: every year and the current period are on file.',
    notes: [],
    fingerprint: 'fp',
    review: null,
    canRunNow: false,
    href: '/clients/c1/financials-comparison',
    ...over,
  }
}

function readiness(items: ReadinessItem[]): Readiness {
  return { items, canPredict: false, waitingFor: [], dpn: null }
}

describe('ReadinessChecklist', () => {
  it('shows each item with its status and what it found', () => {
    render(
      <ReadinessChecklist
        clientId="c1"
        readiness={readiness([
          item({}),
          item({ key: 'lodgement', label: 'ATO activity statement', status: 'processing', detail: 'Waiting to be analysed.', canRunNow: true }),
          item({ key: 'dpn', label: 'Director penalty notices', status: 'not_uploaded', detail: 'Upload the notices.' }),
        ])}
      />,
    )
    const rows = screen.getAllByRole('listitem')
    expect(within(rows[0]).getByText('Ready')).toBeTruthy()
    expect(within(rows[1]).getByText('Processing')).toBeTruthy()
    expect(within(rows[2]).getByText('Not uploaded')).toBeTruthy()
  })

  it('runs out-of-date work on request', async () => {
    const user = userEvent.setup()
    render(<ReadinessChecklist clientId="c1" readiness={readiness([item({ status: 'processing', canRunNow: true })])} />)
    await user.click(screen.getByRole('button', { name: 'Run now' }))
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/clients/c1/analysis/run')
    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })

  it('lists what needs checking, and marks it reviewed', async () => {
    const user = userEvent.setup()
    render(
      <ReadinessChecklist
        clientId="c1"
        readiness={readiness([item({ status: 'needs_review', notes: ['FY2023 Profit and Loss is missing.'] })])}
      />,
    )
    expect(screen.getByText('FY2023 Profit and Loss is missing.')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Mark as reviewed' }))
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/clients/c1/readiness/review')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ item: 'financials' })
  })

  it('shows who reviewed it, in place of the button', () => {
    render(
      <ReadinessChecklist
        clientId="c1"
        readiness={readiness([item({ status: 'needs_review', review: { fingerprint: 'fp', by: 'Sam', at: '2026-10-17T00:00:00Z' } })])}
      />,
    )
    expect(screen.getByText('Reviewed')).toBeTruthy()
    expect(screen.getByText(/Reviewed by Sam/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Mark as reviewed' })).toBeNull()
  })
})

describe('PredictOutcomeButton', () => {
  it('is disabled and says what it is waiting for', () => {
    render(<PredictOutcomeButton clientId="c1" canPredict={false} waitingFor={['Director penalty notices: not uploaded']} />)
    expect((screen.getByRole('button', { name: /Predict SBR Outcome/ }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('Waiting for Director penalty notices: not uploaded.')).toBeTruthy()
  })

  it('links to the prediction once ready', () => {
    render(<PredictOutcomeButton clientId="c1" canPredict waitingFor={[]} />)
    expect(screen.getByRole('link').getAttribute('href')).toBe('/clients/c1/outcome-prediction')
  })
})
