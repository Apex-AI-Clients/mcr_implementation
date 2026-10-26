import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CreditorsSummaryCard, OutcomePredictionClient, basedOnLine, exactFraction, headlineExplanations, offerPercentages } from '../OutcomePredictionClient'

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
  creditorHints: { creditCards: null, cashLoans: null, bankOverdraft: null, tradeSuppliers: null },
  savedCreditors: null,
}

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
        readiness={READY}
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
      <OutcomePredictionClient clientId="c1" clientName="Example Trading" initialAuto={AUTO} initialPrediction={saved()} readiness={READY} />,
    )
    expect(screen.queryByText('New historical data added — re-run')).toBeNull()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
  })
})

describe('practitioner fee selector', () => {
  const page = () =>
    render(<OutcomePredictionClient clientId="c1" clientName="Example Trading" initialAuto={AUTO} initialPrediction={null} readiness={READY} />)

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
    waitingFor: ['Financial statements: processing'],
    dpn: true,
    dpnDetail: '1 notice read (PAYG withholding).',
  }

  it('shows what it is waiting for, keeps Generate disabled, and does not run a saved prediction', async () => {
    const fetchMock = mockFetch()
    render(
      <OutcomePredictionClient clientId="c1" clientName="Example Trading" initialAuto={AUTO} initialPrediction={saved()} readiness={NOT_READY} />,
    )
    expect(screen.getByText('Not ready for a prediction yet')).toBeTruthy()
    expect(screen.getByText('Financial statements: processing')).toBeTruthy()
    expect((screen.getByRole('button', { name: /Generate Prediction/ }) as HTMLButtonElement).disabled).toBe(true)
    await new Promise((r) => setTimeout(r, 20))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('shows the DPN factor read-only, with where it came from, and never sends it', async () => {
    const fetchMock = mockFetch()
    render(<OutcomePredictionClient clientId="c1" clientName="Example Trading" initialAuto={AUTO} initialPrediction={null} readiness={READY} />)
    expect(screen.queryByRole('checkbox', { name: /Director Penalty Notice issued/ })).toBeNull()
    expect(screen.getByText('1 notice read (PAYG withholding).')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /Generate Prediction/ }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(bodyOf(fetchMock)).not.toHaveProperty('dpn')
  })
})

describe('Creditors in the SBR', () => {
  const HINTS = {
    creditCards: { amount: 4_200, source: 'FY2025 balance sheet', caution: null },
    cashLoans: {
      amount: 25_000,
      source: 'FY2025 balance sheet',
      caution: 'Includes $25,000 of chattel, hire-purchase, vehicle or equipment finance. Usually secured — check before including',
    },
    bankOverdraft: { amount: 0, source: 'FY2025 balance sheet', caution: null },
    tradeSuppliers: null,
  }
  const page = (auto: Record<string, unknown> = {}) =>
    render(
      <OutcomePredictionClient
        clientId="c1"
        clientName="Example Trading"
        initialAuto={{ ...AUTO, creditorHints: HINTS, ...auto }}
        initialPrediction={null}
        readiness={READY}
      />,
    )

  it('shows balance-sheet hints beside the rows without filling them in', () => {
    page()
    expect(screen.getByText(/Balance sheet shows \$4,200 \(FY2025 balance sheet\)/)).toBeTruthy()
    expect(screen.getByText(/Usually secured/)).toBeTruthy()
    expect((screen.getByRole('textbox', { name: 'Creditor 1 amount' }) as HTMLInputElement).value).toBe('')
    expect(screen.getByTestId('creditor-total').textContent).toBe('$250,000')
  })

  it('adds the rows to the total and sends them with their labels', async () => {
    const fetchMock = mockFetch()
    page()
    await userEvent.type(screen.getByRole('textbox', { name: 'Creditor 1 amount' }), '12000')
    const label = screen.getByRole('textbox', { name: 'Creditor 4 name' })
    await userEvent.clear(label)
    await userEvent.type(label, 'Supplier account')
    await userEvent.type(screen.getByRole('textbox', { name: 'Creditor 4 amount' }), '38,000')
    expect(screen.getByTestId('creditor-total').textContent).toBe('$300,000')

    await userEvent.click(screen.getByRole('button', { name: /Generate Prediction/ }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const body = bodyOf(fetchMock)
    expect(body.creditors).toHaveLength(4)
    expect(body.creditors[0]).toEqual({ label: 'Credit cards', amount: 12_000, kind: 'creditCards' })
    // Renamed, the row keeps its kind (and its hint).
    expect(body.creditors[3]).toEqual({ label: 'Supplier account', amount: 38_000, kind: 'tradeSuppliers' })
    expect(body.creditors[1]).toEqual({ label: 'Cash loans', amount: null, kind: 'cashLoans' })
    // The automatic ATO debt is not sent: the server works it out.
    expect(body).not.toHaveProperty('creditorAmount')
  })

  it('will not run with an amount that is not a number', async () => {
    page()
    await userEvent.type(screen.getByRole('textbox', { name: 'Creditor 2 amount' }), 'abc')
    expect(screen.getByText(/Enter an amount of \$0 or more/)).toBeTruthy()
    expect((screen.getByRole('button', { name: /Generate Prediction/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('starts from the rows saved with the last prediction', () => {
    page({
      savedCreditors: {
        atoDebt: 90_000,
        atoDebtEdited: true,
        rows: [
          { label: 'Fuel card', amount: 3_000 },
          { label: 'Bank overdraft', amount: null, kind: 'bankOverdraft' },
        ],
      },
    })
    expect((screen.getByRole('textbox', { name: 'Creditor 1 name' }) as HTMLInputElement).value).toBe('Fuel card')
    expect(screen.getByText('Source: entered by staff')).toBeTruthy()
    expect(screen.getByTestId('creditor-total').textContent).toBe('$93,000')
    // Two rows saved, two rows shown.
    expect(screen.queryByRole('textbox', { name: 'Creditor 3 name' })).toBeNull()
  })

  it('adds a row to name and fill in, and removes rows', async () => {
    const fetchMock = mockFetch()
    page()
    await userEvent.click(screen.getByRole('button', { name: /Add creditor/ }))
    const name = screen.getByRole('textbox', { name: 'Creditor 5 name' })
    expect(document.activeElement).toBe(name)
    await userEvent.type(name, 'Landlord – unpaid rent')
    await userEvent.type(screen.getByRole('textbox', { name: 'Creditor 5 amount' }), '9500')
    await userEvent.click(screen.getByRole('button', { name: 'Remove Credit cards' }))
    await userEvent.click(screen.getByRole('button', { name: 'Remove Bank overdraft' }))
    expect(screen.queryByRole('textbox', { name: 'Creditor 4 name' })).toBeNull()
    expect(screen.getByTestId('creditor-total').textContent).toBe('$259,500')

    await userEvent.click(screen.getByRole('button', { name: /Generate Prediction/ }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(bodyOf(fetchMock).creditors).toEqual([
      { label: 'Cash loans', amount: null, kind: 'cashLoans' },
      { label: 'Trade suppliers', amount: null, kind: 'tradeSuppliers' },
      { label: 'Landlord – unpaid rent', amount: 9_500 },
    ])
  })

  it('keeps each hint with its row when rows above it are removed', async () => {
    page()
    expect(screen.getByText(/Balance sheet shows \$25,000/)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Remove Credit cards' }))
    expect(screen.queryByText(/Balance sheet shows \$4,200/)).toBeNull()
    // Cash loans is now the first row, still with its own hint.
    expect((screen.getByRole('textbox', { name: 'Creditor 1 name' }) as HTMLInputElement).value).toBe('Cash loans')
    expect(screen.getByText(/Balance sheet shows \$25,000/)).toBeTruthy()
  })

  it('can remove every row', async () => {
    page()
    for (const label of ['Credit cards', 'Cash loans', 'Bank overdraft', 'Trade suppliers']) {
      await userEvent.click(screen.getByRole('button', { name: `Remove ${label}` }))
    }
    expect(screen.queryByRole('textbox', { name: 'Creditor 1 name' })).toBeNull()
    expect(screen.getByTestId('creditor-total').textContent).toBe('$250,000')
  })
})

describe('Creditors in the SBR — in the PDF', () => {
  it('lists the ATO debt, each row with an amount, and the total', () => {
    const prediction = {
      creditorAmount: 150_000,
      atoDebt: 100_000,
      creditorDebt: { description: 'ATO account statement, 30 Sep 2026', missing: null, source: 'ica' },
      creditors: [
        { label: 'Credit cards', amount: 12_000 },
        { label: 'Bank overdraft', amount: null },
        { label: 'Supplier account', amount: 38_000 },
      ],
      practitionerFeeRate: 0.125,
    }
    render(<CreditorsSummaryCard prediction={prediction as never} />)
    expect(screen.getByText('Credit cards')).toBeTruthy()
    expect(screen.getByText('Supplier account')).toBeTruthy()
    expect(screen.queryByText('Bank overdraft')).toBeNull()
    expect(screen.getByText('$150,000')).toBeTruthy()
    expect(screen.getByText(/ATO account statement, 30 Sep 2026/)).toBeTruthy()
  })
})

describe('days since last payment', () => {
  it('says the whole ATO account was searched when there are no payments', () => {
    render(
      <OutcomePredictionClient
        clientId="c1"
        clientName="Example Trading"
        initialAuto={{ ...AUTO, daysSinceLastPayment: 9999, icaHistory: '1 Jul 2020 – 1 Oct 2026' }}
        initialPrediction={null}
        readiness={READY}
      />,
    )
    expect(screen.getByText('No payments found in the ATO account (1 Jul 2020 – 1 Oct 2026)')).toBeTruthy()
  })
})

describe('calculation steps', () => {
  it('shows the exact fraction the offer was worked out with, so the steps reconcile', () => {
    // 42.4125% x $303,827.46 = $128,860.8; / 0.875 = $147,269.5
    expect(exactFraction(42.4125)).toBe('0.424125')
    expect(exactFraction(59.3)).toBe('0.593')
    expect(exactFraction(40)).toBe('0.4')
  })
})

describe('director penalty notice not on file', () => {
  const NOTHING_ON_FILE = { canPredict: true, waitingFor: [], dpn: null, dpnDetail: '' }

  it('lets staff tick it, and sends their answer', async () => {
    const fetchMock = mockFetch()
    render(
      <OutcomePredictionClient
        clientId="c1"
        clientName="Example Trading"
        initialAuto={AUTO}
        initialPrediction={null}
        readiness={NOTHING_ON_FILE}
      />,
    )
    const box = screen.getByRole('checkbox', { name: 'Director Penalty Notice issued' }) as HTMLInputElement
    expect(box.checked).toBe(false)
    const button = screen.getByRole('button', { name: /Generate Prediction/ }) as HTMLButtonElement
    expect(button.disabled).toBe(false)
    await userEvent.click(box)
    await userEvent.click(button)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(bodyOf(fetchMock).dpn).toBe(true)
  })

  it('sends No when left unticked', async () => {
    const fetchMock = mockFetch()
    render(
      <OutcomePredictionClient
        clientId="c1"
        clientName="Example Trading"
        initialAuto={AUTO}
        initialPrediction={null}
        readiness={NOTHING_ON_FILE}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /Generate Prediction/ }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(bodyOf(fetchMock).dpn).toBe(false)
  })
})

describe('SBR offer percentage and expected discount (Gabby, 21 Oct)', () => {
  it('is the SBR payment ÷ total creditors, and 100% less that, rounded to two decimals', () => {
    // 43.6967%: rounded, not cut off (the review's example showed 43.69%).
    expect(offerPercentages(97_500, 223_129)).toEqual({ offer: 43.7, discount: 56.3 })
    expect(offerPercentages(87_500, 200_000)).toEqual({ offer: 43.75, discount: 56.25 })
  })

  it('needs a payment and a total', () => {
    expect(offerPercentages(null, 223_129)).toBeNull()
    expect(offerPercentages(97_500, null)).toBeNull()
    expect(offerPercentages(97_500, 0)).toBeNull()
  })

  it('says which payment type the similar cases were chosen with', () => {
    expect(basedOnLine(8, 'plan')).toBe('Based on the 8 past cases most similar to this client with a payment plan offer.')
    expect(basedOnLine(8, 'upfront')).toBe('Based on the 8 past cases most similar to this client with an upfront offer.')
  })
})

describe('how the offer figures were calculated', () => {
  const cases = [40, 42, 38, 44].map((outcomePercent, i) => ({ outcomePercent, id: `c${i}` }))
  const prediction = {
    comparableCases: cases,
    predictedOutcomePercent: 41,
    practitionerFeeRate: 0.1,
    creditorAmount: 200_000,
    atoDebt: 150_000,
    creditors: [{ label: 'Trade creditors', amount: 50_000 }, { label: 'Blank', amount: null }],
  } as unknown as Parameters<typeof headlineExplanations>[0]

  it('shows the offer percentage with the payment, the creditors and how the payment was sized', () => {
    const { offer } = headlineExplanations(prediction, 91_000)
    expect(offer).toContain('$91,000 ÷ $200,000 = 45.50%')
    expect(offer).toContain('ATO debt $150,000 + Trade creditors $50,000 = $200,000')
    expect(offer).toContain('41% × $200,000 = $82,000.00')
    expect(offer).toContain('$82,000.00 ÷ 0.900 = $91,111.11')
    expect(offer).not.toContain('Blank')
  })

  it('shows the discount as 100% less the offer', () => {
    expect(headlineExplanations(prediction, 91_000).discount).toContain('100% − 45.50% = 54.50%')
  })

  it('shows the cents in the dollar as the average of the similar cases', () => {
    const { cents } = headlineExplanations(prediction, 91_000)
    expect(cents).toContain('40.0 + 42.0 + 38.0 + 44.0 = 164.0')
    expect(cents).toContain('164.0 ÷ 4 = 41, shown as 41.0c')
  })

  it('has no offer or discount working without a creditor total', () => {
    const r = headlineExplanations({ ...prediction, creditorAmount: null }, null)
    expect(r.offer).toBeNull()
    expect(r.discount).toBeNull()
    expect(r.cents).toBeTruthy()
  })
})

describe('director loan: fresh balance sheet over a stale saved value', () => {
  // $120,000 owed to the company on the balance sheet at 30 Jun 2026.
  const LOAN_AUTO = {
    ...AUTO,
    directorLoanReceivableAmount: 120_000,
    directorLoanDetected: true,
    directorLoanReasoning: 'Loan owed to the company of $120,000 on the FY2026 balance sheet: “Loan - Related Parties”.',
    directorLoanAsOf: '2026-06-30',
  }
  const NOTE =
    'Ticked Yes: the balance sheet at 30 Jun 2026 shows “Loan - Related Parties” $120,000 owed to the company (last prediction said No).'
  const LABEL = 'Director loan at appointment (from the balance sheet at 30 Jun 2026)'

  it('starts at Yes with the note, names the balance sheet, and asks for a re-run instead of running', () => {
    const fetchMock = mockFetch()
    render(
      <OutcomePredictionClient
        clientId="c1"
        clientName="Example Trading"
        initialAuto={{ ...LOAN_AUTO, directorLoanInitial: { value: true, note: NOTE, override: null } }}
        initialPrediction={{ ...saved(), inputsChanged: ['Director loan at appointment', 'Director loan receivable amount'] }}
        readiness={READY}
      />,
    )
    expect((screen.getByRole('checkbox', { name: LABEL }) as HTMLInputElement).checked).toBe(true)
    expect(screen.getByText(NOTE)).toBeTruthy()
    expect(screen.getByText('Director loan receivable amount (from the balance sheet at 30 Jun 2026)')).toBeTruthy()
    expect(screen.getByText('Inputs changed — re-run')).toBeTruthy()
    expect(screen.getByText(/Director loan at appointment, Director loan receivable amount\. Check the inputs/)).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("keeps staff's No and its reason when the override stands", async () => {
    const fetchMock = mockFetch()
    const override = { value: false, reason: 'Loan repaid before appointment', setAt: '2026-10-21T10:00:00Z', amount: 120_000 }
    render(
      <OutcomePredictionClient
        clientId="c1"
        clientName="Example Trading"
        initialAuto={{ ...LOAN_AUTO, directorLoanInitial: { value: false, note: null, override } }}
        initialPrediction={{ ...saved(), inputsChanged: [] }}
        readiness={READY}
      />,
    )
    expect((screen.getByRole('checkbox', { name: LABEL }) as HTMLInputElement).checked).toBe(false)
    expect((screen.getByLabelText(/Reason for keeping No/) as HTMLTextAreaElement).value).toBe('Loan repaid before appointment')
    // Not contradicted: it runs as before, sending the reason with it.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(bodyOf(fetchMock)).toMatchObject({ directorLoanAtAppointment: false, directorLoanOverrideReason: 'Loan repaid before appointment' })
  })

  it('warns on No with a loan owed, and will not run until a reason is given', async () => {
    const fetchMock = mockFetch()
    render(
      <OutcomePredictionClient
        clientId="c1"
        clientName="Example Trading"
        initialAuto={{ ...LOAN_AUTO, directorLoanInitial: { value: true, note: null, override: null } }}
        initialPrediction={null}
        readiness={READY}
      />,
    )
    const generate = screen.getByRole('button', { name: /Generate Prediction/ }) as HTMLButtonElement
    expect(generate.disabled).toBe(false)

    await userEvent.click(screen.getByRole('checkbox', { name: LABEL }))
    expect(
      screen.getByText(
        'Director loan at appointment is No, but the balance sheet at 30 Jun 2026 shows $120,000 owed to the company. Tick Yes, or give a reason for keeping No.',
      ),
    ).toBeTruthy()
    expect(generate.disabled).toBe(true)

    await userEvent.type(screen.getByLabelText(/Reason for keeping No/), 'Loan repaid before appointment')
    expect(generate.disabled).toBe(false)
    await userEvent.click(generate)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(bodyOf(fetchMock).directorLoanOverrideReason).toBe('Loan repaid before appointment')
  })
})

describe('Creditors in the SBR — the other ATO accounts (setting on)', () => {
  const ATO_ROWS = [
    { label: 'ATO: Income tax 001, at 1 Oct 2026', amount: 20_100 },
    { label: 'ATO: Superannuation guarantee employer 005, at 22 Sep 2026', amount: 50_000 },
  ]

  it('starts a new prediction with a named, dated row per account, sent like any row', async () => {
    const fetchMock = mockFetch()
    render(
      <OutcomePredictionClient clientId="c1" clientName="Example Trading" initialAuto={{ ...AUTO, atoAccountRows: ATO_ROWS }} initialPrediction={null} readiness={READY} />,
    )
    expect((screen.getByRole('textbox', { name: 'Creditor 1 name' }) as HTMLInputElement).value).toBe('ATO: Income tax 001, at 1 Oct 2026')
    expect((screen.getByRole('textbox', { name: 'Creditor 2 amount' }) as HTMLInputElement).value).toBe('50000')
    // ATO debt $250,000 + the two accounts.
    expect(screen.getByTestId('creditor-total').textContent).toBe('$320,100')
    await userEvent.click(screen.getByRole('button', { name: /Generate Prediction/ }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(bodyOf(fetchMock).creditors.slice(0, 2)).toEqual([
      { label: 'ATO: Income tax 001, at 1 Oct 2026', amount: 20_100 },
      { label: 'ATO: Superannuation guarantee employer 005, at 22 Sep 2026', amount: 50_000 },
    ])
  })

  it('offers them, not adds them, when creditors were saved before', async () => {
    render(
      <OutcomePredictionClient
        clientId="c1"
        clientName="Example Trading"
        initialAuto={{ ...AUTO, atoAccountRows: ATO_ROWS, savedCreditors: { atoDebt: 250_000, atoDebtEdited: false, rows: [{ label: 'Credit cards', amount: 1_000 }] } }}
        initialPrediction={null}
        readiness={READY}
      />,
    )
    expect(screen.getAllByRole('textbox', { name: /Creditor \d+ name/ })).toHaveLength(1)
    await userEvent.click(screen.getByRole('button', { name: 'Add the other ATO accounts (2)' }))
    expect(screen.getAllByRole('textbox', { name: /Creditor \d+ name/ })).toHaveLength(3)
    expect(screen.queryByRole('button', { name: /Add the other ATO accounts/ })).toBeNull()
  })

  it('shows nothing of them while the setting is off', () => {
    render(<OutcomePredictionClient clientId="c1" clientName="Example Trading" initialAuto={{ ...AUTO, atoAccountRows: [] }} initialPrediction={null} readiness={READY} />)
    expect(screen.queryByRole('button', { name: /Add the other ATO accounts/ })).toBeNull()
    expect((screen.getByRole('textbox', { name: 'Creditor 1 name' }) as HTMLInputElement).value).toBe('Credit cards')
  })
})

