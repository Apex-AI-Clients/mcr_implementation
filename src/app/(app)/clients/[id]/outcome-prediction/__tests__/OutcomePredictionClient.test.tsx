import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FinancialPointsPanel, OutcomePredictionClient } from '../OutcomePredictionClient'

/**
 * The prediction page's stale banner and practitioner-fee selector. Synthetic
 * data only. The predict call is answered with an error so nothing beyond the
 * inputs renders; what matters is when it is called, and with what.
 */

const AUTO = {
  cumulativeDaysLate: 450,
  numberOfLateLodgements: 9,
  daysSinceLastPayment: 120,
  directorLoanReceivableAmount: 0,
  directorLoanDetected: false,
  directorLoanReasoning: null,
  creditorAmount: 250_000,
  creditorSource: 'ATO account statement',
  creditorMissing: null,
  latestFinancialYear: 2025,
  hasLodgement: true,
  hasFinancials: true,
}

const NO_POINTS = { available: false, points: [] }

const READY = { canPredict: true, waitingFor: [], dpn: true, dpnDetail: '1 notice read (PAYG withholding).' }

function saved(overrides: { stale?: boolean; practitionerFeeRate?: number } = {}) {
  return {
    inputFeatures: { dpn: false, paymentPlanType: 'plan', directorLoanAtAppointment: false },
    predictedOutcomePercent: 38.4,
    predictedLowPercent: 30.1,
    predictedHighPercent: 46.7,
    comparableCaseIds: [],
    trainingSetSize: 59,
    computedAt: '2026-10-01T00:00:00Z',
    practitionerFeeRate: 0.125,
    stale: false,
    ...overrides,
  }
}

function mockFetch() {
  const fetchMock = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ error: 'stub' }) }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const bodyOf = (fetchMock: ReturnType<typeof mockFetch>, call = 0) =>
  JSON.parse((fetchMock.mock.calls[call] as unknown as [string, { body: string }])[1].body)

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('stale saved prediction', () => {
  it('shows the saved figures with the banner, and does not re-run on its own', async () => {
    const fetchMock = mockFetch()
    render(
      <OutcomePredictionClient
        clientId="c1"
        clientName="Example Trading"
        initialAuto={AUTO}
        initialPrediction={saved({ stale: true, practitionerFeeRate: 0.1 })}
        readiness={READY} financialPoints={NO_POINTS}
      />,
    )
    expect(screen.getByText('New historical data added — re-run')).toBeTruthy()
    expect(screen.getByText(/38\.4%, range 30\.1%–46\.7%, from 59 cases/)).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()

    // Re-run uses the fee saved for this client.
    const rerun = screen.getAllByRole('button', { name: /Re-run/ })[0]
    await userEvent.click(rerun)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(bodyOf(fetchMock)).toMatchObject({ practitionerFeeRate: 0.1, paymentPlanType: 'plan' })
  })

  it('re-runs a saved prediction that is not stale on load, as before', async () => {
    const fetchMock = mockFetch()
    render(
      <OutcomePredictionClient clientId="c1" clientName="Example Trading" initialAuto={AUTO} initialPrediction={saved()} readiness={READY} financialPoints={NO_POINTS} />,
    )
    expect(screen.queryByText('New historical data added — re-run')).toBeNull()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
  })
})

describe('practitioner fee selector', () => {
  const page = () =>
    render(<OutcomePredictionClient clientId="c1" clientName="Example Trading" initialAuto={AUTO} initialPrediction={null} readiness={READY} financialPoints={NO_POINTS} />)

  it('defaults to 12.5% and sends the chosen fee', async () => {
    const fetchMock = mockFetch()
    page()
    expect((screen.getByRole('radio', { name: /12\.5%/ }) as HTMLInputElement).checked).toBe(true)
    await userEvent.click(screen.getByRole('radio', { name: '7.5%' }))
    await userEvent.click(screen.getByRole('button', { name: /Generate Prediction/ }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(bodyOf(fetchMock).practitionerFeeRate).toBe(0.075)
  })

  it('takes a custom percentage, and blocks the run until it is valid', async () => {
    const fetchMock = mockFetch()
    page()
    await userEvent.click(screen.getByRole('radio', { name: 'Custom' }))
    const generate = screen.getByRole('button', { name: /Generate Prediction/ }) as HTMLButtonElement
    expect(generate.disabled).toBe(true)
    expect(screen.getByText(/Enter a fee from 0% to below 50%/)).toBeTruthy()

    await userEvent.type(screen.getByLabelText('Custom practitioner fee, percent'), '8')
    expect(generate.disabled).toBe(false)
    await userEvent.click(generate)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(bodyOf(fetchMock).practitionerFeeRate).toBeCloseTo(0.08)
  })
})

describe('readiness and the DPN factor', () => {
  const NOT_READY = {
    canPredict: false,
    waitingFor: ['Director penalty notices: not uploaded'],
    dpn: null,
    dpnDetail: 'Upload the notices, or tick "No director penalty notice has been issued".',
  }

  it('shows what it is waiting for, keeps Generate disabled, and does not run a saved prediction', async () => {
    const fetchMock = mockFetch()
    render(
      <OutcomePredictionClient clientId="c1" clientName="Example Trading" initialAuto={AUTO} initialPrediction={saved()} readiness={NOT_READY} financialPoints={NO_POINTS} />,
    )
    expect(screen.getByText('Not ready for a prediction yet')).toBeTruthy()
    expect(screen.getByText('Director penalty notices: not uploaded')).toBeTruthy()
    expect((screen.getByRole('button', { name: /Generate Prediction/ }) as HTMLButtonElement).disabled).toBe(true)
    await new Promise((r) => setTimeout(r, 20))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('shows the DPN factor read-only, with where it came from, and never sends it', async () => {
    const fetchMock = mockFetch()
    render(<OutcomePredictionClient clientId="c1" clientName="Example Trading" initialAuto={AUTO} initialPrediction={null} readiness={READY} financialPoints={NO_POINTS} />)
    expect(screen.queryByRole('checkbox', { name: /Director Penalty Notice issued/ })).toBeNull()
    expect(screen.getByText('1 notice read (PAYG withholding).')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /Generate Prediction/ }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(bodyOf(fetchMock)).not.toHaveProperty('dpn')
  })
})

describe('What the financial statements show', () => {
  it('gives the framing, then each point', () => {
    render(
      <FinancialPointsPanel
        data={{
          available: true,
          points: [{ rule: 'b', text: 'Property, plant & equipment rose from $138,683 (FY2023) to $269,741 (FY2026).' }],
        }}
      />,
    )
    expect(screen.getByText(/explain the situation but don't change the %/)).toBeTruthy()
    expect(screen.getByText('Property, plant & equipment rose from $138,683 (FY2023) to $269,741 (FY2026).')).toBeTruthy()
  })

  it('waits for a verified comparison', () => {
    render(<FinancialPointsPanel data={{ available: false, points: [] }} />)
    expect(screen.getByText('Financial points will appear once the financial comparison is verified.')).toBeTruthy()
  })
})
