import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { LeaveOneOutResult } from '@/lib/sbr/accuracy'
import type { ImportPreview } from '@/lib/sbr/import/types'
import type { PredictionCaseRow, PredictionDataStats } from '@/lib/sbr/predictionData'
import { bandRows } from '../BehindTheNumbers'
import { CaseExplorer } from '../CaseExplorer'
import { CasesList, matchCases, type CaseFilter } from '../CasesList'
import { DataToday } from '../DataToday'
import { CaseDialog, GlossaryDialog, UndoDialog } from '../Dialogs'
import { HeroExplainer, buildMap } from '../HeroExplainer'
import { SimpleUploadDialog } from '../SimpleUploadDialog'
import { UploadDialog } from '../UploadDialog'
import { UploadHistory } from '../UploadHistory'

/** The Prediction Data page's parts. Synthetic names and figures only. */

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

let n = 0
function kase(overrides: Partial<PredictionCaseRow> = {}): PredictionCaseRow {
  n += 1
  return {
    id: `case-${n}`,
    clientName: `Sample Client ${n} Pty Ltd`,
    accepted: true,
    outcomePercent: 30 + (n % 7) * 3,
    share: 0.875,
    dataCheck: false,
    excluded: false,
    excludedReason: null,
    importId: null,
    sourceLabel: 'Initial data',
    factors: {
      dpn: n % 3 === 0,
      paymentPlanType: n % 2 ? 'plan' : 'upfront',
      directorLoanAtAppointment: false,
      directorLoanReceivableAmount: 0,
      cumulativeDaysLate: (n * 137) % 3000,
      numberOfLateLodgements: (n * 7) % 40,
      daysSinceLastPayment: n % 5 === 0 ? null : (n * 53) % 900,
    },
    creditorAmount: 250_000 + n * 1000,
    sbrPayment: 100_000,
    businessType: n % 2 ? 'Retail' : null,
    ...overrides,
  }
}

const CASES: PredictionCaseRow[] = [
  kase({ clientName: 'Alpha Trading Pty Ltd' }),
  kase({
    clientName: 'Bravo & Sons Pty Ltd',
    accepted: false,
    dataCheck: true,
    share: 0.5,
    importId: 'u1',
    sourceLabel: 'cases.xlsx · 14 Oct 2026',
  }),
  ...Array.from({ length: 14 }, (_, i) => kase({ accepted: i % 4 !== 0 })),
]

describe('HeroExplainer', () => {
  it('draws exactly 2 rejected among the 8 nearest, and closer matches after new cases', () => {
    const map = buildMap()
    expect(map.nearBase).toHaveLength(8)
    expect(map.nearBase.filter((p) => !p.accepted)).toHaveLength(2)
    expect(map.extra).toHaveLength(12)
    expect(map.closer).toBeGreaterThan(0)
    expect(buildMap()).toEqual(map)
  })

  it('walks through the steps with the real numbers and the real method', async () => {
    render(<HeroExplainer total={83} accepted={65} rejected={18} accuracy={7.2} hold={false} />)
    expect(screen.getByText(/No AI model guesses here/)).toBeTruthy()
    expect(screen.getByText(/Each of the 83 finished restructurings \(65 plans accepted, 18 rejected\)/)).toBeTruthy()
    expect(screen.getByText('Step 1 of 4')).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'Next step' }))
    await userEvent.click(screen.getByRole('button', { name: 'Next step' }))
    expect(screen.getByText('Step 3 of 4')).toBeTruthy()
    // The prediction is an average of the 8, and the band comes from rejections.
    expect(screen.getByText(/average cents in the dollar those 8 offered/)).toBeTruthy()
    expect(screen.queryByText(/count a little more/)).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Every upload makes matches closer' }))
    expect(screen.getByText(/typically within ±7.2 points/)).toBeTruthy()
  })
})

describe('DataToday', () => {
  const stats: PredictionDataStats = {
    total: 83,
    accepted: 65,
    rejected: 18,
    lastUploadAt: null,
    lastUploadBy: null,
    lastUploadAdded: null,
    initialCases: 59,
    dataChecks: 2,
  }

  it('filters the list from the counts and the data checks', async () => {
    const onFilter = vi.fn()
    render(<DataToday stats={stats} accuracy={7.2} onFilter={onFilter} />)
    await userEvent.click(screen.getByRole('button', { name: /18 plans rejected/ }))
    expect(onFilter).toHaveBeenCalledWith('rejected')
    await userEvent.click(screen.getByRole('button', { name: 'Show them' }))
    expect(onFilter).toHaveBeenCalledWith('checks')
    expect(screen.getByText('To look at')).toBeTruthy()
    expect(screen.getByText(/Only the initial data so far/)).toBeTruthy()
  })

  it('shows new figures straight away when the data changes, without a reload', async () => {
    const { rerender } = render(<DataToday stats={{ ...stats, total: 59, accepted: 41, rejected: 18 }} accuracy={7.7} onFilter={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('59')).toBeTruthy(), { timeout: 3000 })
    // What router.refresh() does after an upload: the same component, new props.
    rerender(<DataToday stats={stats} accuracy={7.2} onFilter={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('83')).toBeTruthy(), { timeout: 3000 })
    expect(screen.queryByText('59')).toBeNull()
    expect(screen.getByText('±7.2')).toBeTruthy()
  })

  it('says all clear when there are no data checks', () => {
    render(<DataToday stats={{ ...stats, dataChecks: 0 }} accuracy={null} onFilter={vi.fn()} />)
    expect(screen.getByText('All clear')).toBeTruthy()
    expect(screen.getByText('Not enough cases yet')).toBeTruthy()
  })
})

function List() {
  const [filter, setFilter] = useState<CaseFilter>('all')
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [limit, setLimit] = useState(8)
  return (
    <CasesList
      sectionRef={{ current: null }}
      cases={CASES}
      filter={filter}
      onFilter={setFilter}
      query={query}
      onQuery={setQuery}
      openId={openId}
      onToggle={(id) => setOpenId((o) => (o === id ? null : id))}
      limit={limit}
      onMore={() => setLimit((l) => l + 8)}
      onClear={() => {
        setFilter('all')
        setQuery('')
        setLimit(8)
      }}
    />
  )
}

describe('CasesList', () => {
  it('matches by normalised name, business type and upload', () => {
    expect(matchCases(CASES, 'all', 'bravo and sons').map((c) => c.clientName)).toEqual(['Bravo & Sons Pty Ltd'])
    expect(matchCases(CASES, 'uploads', '')).toHaveLength(1)
    expect(matchCases(CASES, 'checks', '')).toHaveLength(1)
    expect(matchCases(CASES, 'all', 'retail').length).toBeGreaterThan(0)
  })

  it('opens a case to show the 7 facts and its data check', async () => {
    render(<List />)
    await userEvent.click(screen.getByRole('button', { name: /Bravo & Sons Pty Ltd/ }))
    expect(screen.getByText('Days since last payment')).toBeTruthy()
    expect(screen.getByText(/creditors would get 50% of the payment/)).toBeTruthy()
  })

  it('filters with chips, pages with Show 8 more, and offers a way out of an empty result', async () => {
    render(<List />)
    expect(screen.getByText('Showing 8 of 16')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Show 8 more' }))
    expect(screen.getByText('Showing 16 of 16')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /^Data checks/ }))
    expect(screen.getByText('Showing 1 of 1')).toBeTruthy()
    await userEvent.type(screen.getByRole('searchbox'), 'zzz')
    expect(screen.getByText('No cases match')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Clear search and filters' }))
    expect(screen.getByText('Showing 8 of 16')).toBeTruthy()
  })
})

describe('CaseExplorer', () => {
  it('shows a case and its 8 most similar on hover, and opens it on click', async () => {
    const onOpen = vi.fn()
    render(<CaseExplorer cases={CASES} highlight={null} highlightLabel="" onClearHighlight={vi.fn()} onOpen={onOpen} />)
    const point = screen.getByRole('button', { name: /Alpha Trading Pty Ltd/ })
    fireEvent.mouseEnter(point)
    const tip = screen.getByRole('tooltip')
    expect(within(tip).getByText('Alpha Trading Pty Ltd')).toBeTruthy()
    expect(within(tip).getByText(/of 8 accepted/)).toBeTruthy()
    await userEvent.click(point)
    expect(onOpen).toHaveBeenCalledWith(CASES[0].id)
  })

  it('switches the factor and shows the highlight from the list', async () => {
    const onClear = vi.fn()
    render(
      <CaseExplorer
        cases={CASES}
        highlight={new Set([CASES[1].id])}
        highlightLabel="“Data checks”"
        onClearHighlight={onClear}
        onOpen={vi.fn()}
      />,
    )
    expect(screen.getByText(/Highlighting “Data checks”/)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Days since last payment' }))
    expect(screen.getByRole('button', { name: 'Days since last payment' }).getAttribute('aria-pressed')).toBe('true')
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(onClear).toHaveBeenCalled()
  })
})

describe('BehindTheNumbers', () => {
  it('groups the leave-one-out evidence by band', () => {
    const accuracy: LeaveOneOutResult = {
      sampleSize: 83,
      meanAbsoluteError: 7.2,
      rangeCoverage: 0.73,
      byRejectedNeighbours: [
        { rejectedNeighbours: 0, cases: 24, actuallyRejected: 4 },
        { rejectedNeighbours: 1, cases: 30, actuallyRejected: 4 },
        { rejectedNeighbours: 2, cases: 13, actuallyRejected: 4 },
        { rejectedNeighbours: 3, cases: 15, actuallyRejected: 6 },
        { rejectedNeighbours: 4, cases: 1, actuallyRejected: 0 },
      ],
    }
    expect(bandRows(accuracy)).toEqual([
      { band: 'likely_accepted', rule: '0–1 of 8 rejected', cases: 54, accepted: 46 },
      { band: 'borderline', rule: '2 of 8 rejected', cases: 13, accepted: 9 },
      { band: 'high_rejection_risk', rule: '3+ of 8 rejected', cases: 16, accepted: 10 },
    ])
  })
})

describe('UploadHistory', () => {
  it('lists the uploads in force with Undo, leaves undone ones out, and ends with the initial data', async () => {
    const onUndo = vi.fn()
    const history = [
      {
        id: 'u2',
        uploadedAt: '2026-10-14T00:00:00Z',
        uploadedBy: 'Sam',
        fileName: 'cases.xlsx',
        counts: { added: 24, corrected: 3, rejected: 8 },
        undoneAt: null,
        undoneBy: null,
      },
      {
        id: 'u1',
        uploadedAt: '2026-10-13T00:00:00Z',
        uploadedBy: 'Sam',
        fileName: 'template.csv',
        counts: { added: 1 },
        undoneAt: '2026-10-13T01:00:00Z',
        undoneBy: 'Sam',
      },
    ]
    render(<UploadHistory history={history} initialCases={59} busyId={null} onUndo={onUndo} />)
    expect(screen.getAllByRole('button', { name: /Undo upload/ })).toHaveLength(1)
    expect(screen.queryByText('template.csv')).toBeNull()
    expect(screen.queryByText('Undone')).toBeNull()
    expect(screen.getByText('8 rows')).toBeTruthy()
    expect(screen.getByText('Original data')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Undo upload cases.xlsx' }))
    expect(onUndo).toHaveBeenCalledWith(history[0])
  })
})

describe('Dialogs', () => {
  it('glossary explains the words, keeping "rejected" and "not imported" apart', () => {
    render(<GlossaryDialog open onClose={vi.fn()} />)
    const panel = screen.getByRole('dialog')
    expect(within(panel).getByText('Plan rejected')).toBeTruthy()
    expect(within(panel).getByText(/It is about the row, not the result/)).toBeTruthy()
  })

  it('case dialog shows the facts and finds the case in the table', async () => {
    const onFind = vi.fn()
    render(<CaseDialog c={CASES[1]} onClose={vi.fn()} onFind={onFind} />)
    expect(screen.getByRole('heading', { name: 'Bravo & Sons Pty Ltd' })).toBeTruthy()
    expect(screen.getByText(/Data check:/)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Find in table' }))
    expect(onFind).toHaveBeenCalledWith(CASES[1].id)
  })

  it('undo dialog says what will happen, and that the cases come back only by uploading again', async () => {
    const onConfirm = vi.fn()
    const entry = {
      id: 'u2',
      uploadedAt: '2026-10-14T00:00:00Z',
      uploadedBy: 'Sam',
      fileName: 'cases.xlsx',
      counts: { added: 24, corrected: 3 },
      undoneAt: null,
      undoneBy: null,
    }
    render(<UndoDialog entry={entry} busy={false} error={null} onClose={vi.fn()} onConfirm={onConfirm} />)
    expect(screen.getByText(/To add them again, upload the file again/)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Undo upload' }))
    expect(onConfirm).toHaveBeenCalled()
  })
})

const PREVIEW: ImportPreview = {
  tabs: [{ tab: 'Data', status: 'read', rows: 4, detail: null }],
  added: [
    {
      key: 'alpha',
      ref: { tab: 'Data', rowNumber: 2 },
      record: { client_name: 'New Alpha Pty Ltd', accepted: true } as never,
      notes: [],
    },
  ],
  corrections: [
    {
      key: 'bravo',
      ref: { tab: 'Data', rowNumber: 3 },
      clientName: 'Bravo Pty Ltd',
      caseId: 'case-x',
      changes: [{ column: 'sbr_payment', label: 'SBR payment', from: '$100,000.00', to: '$95,000.00' }],
      values: {},
      expected: {},
      notes: [],
    },
  ],
  alreadyHave: [{ ref: { tab: 'Data', rowNumber: 4 }, clientName: 'Charlie Pty Ltd' }],
  detailsAdded: [],
  rejected: [
    {
      ref: { tab: 'Data', rowNumber: 5 },
      clientName: 'Delta Pty Ltd',
      reasons: [{ code: 'payment_type', message: 'Payment type "Upfront and Plan" not supported yet.' }],
      raw: { 'Client Name': 'Delta Pty Ltd' },
    },
  ],
  counts: { added: 1, corrections: 1, already_have: 1, details_added: 0, rejected: 1 },
}

describe('UploadDialog', () => {
  it('checks a file, shows the review, and confirms with the ticked corrections', async () => {
    const calls: { url: string; corrections: string | null }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: { body: FormData }) => {
        calls.push({ url, corrections: init.body.get('corrections') as string | null })
        if (url.endsWith('/preview')) return { ok: true, json: async () => ({ fileName: 'cases.csv', preview: PREVIEW }) }
        return { ok: true, json: async () => ({ importId: 'imp-1', counts: { added: 1, corrected: 1 } }) }
      }),
    )
    const onImported = vi.fn()
    render(<UploadDialog open onClose={vi.fn()} onImported={onImported} />)
    expect(screen.getByText('Drop your CSV or Excel file here')).toBeTruthy()

    await userEvent.upload(screen.getByLabelText('Choose a CSV or Excel file'), new File(['x'], 'cases.csv', { type: 'text/csv' }))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Review before anything changes' })).toBeTruthy(), {
      timeout: 4000,
    })

    const panel = screen.getByRole('dialog')
    expect(within(panel).getByRole('heading', { name: 'Not imported' })).toBeTruthy()
    expect(within(panel).getByText(/not supported yet/)).toBeTruthy()
    expect(within(panel).getByText('Plan accepted:')).toBeTruthy()

    const box = within(panel).getByRole('checkbox') as HTMLInputElement
    expect(box.checked).toBe(false)
    await userEvent.click(box)
    await userEvent.click(within(panel).getByRole('button', { name: 'Confirm and add 1 case' }))

    await waitFor(() => expect(onImported).toHaveBeenCalledWith({ importId: 'imp-1', counts: { added: 1, corrected: 1 } }))
    expect(calls[1]).toEqual({ url: '/api/admin/sbr/case-imports', corrections: '["bravo"]' })
  })

  it('shows a refusal from the check and stays on the drop step', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({ error: "This doesn't look like an Excel file." }) })))
    render(<UploadDialog open onClose={vi.fn()} onImported={vi.fn()} />)
    await userEvent.upload(
      screen.getByLabelText('Choose a CSV or Excel file'),
      new File(['x'], 'cases.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    )
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain("doesn't look like an Excel file"), {
      timeout: 4000,
    })
    expect(screen.getByText('Drop your CSV or Excel file here')).toBeTruthy()
  })
})

describe('SimpleUploadDialog', () => {
  it('uploads the chosen file in one step and shows what happened', async () => {
    const sent: { url: string; corrections: string | null }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: { body: FormData }) => {
        sent.push({ url, corrections: init.body.get('corrections') as string | null })
        return {
          ok: true,
          json: async () => ({ importId: 'imp-1', counts: { added: 24, already_have: 47, corrections_not_applied: 3, rejected: 8 } }),
        }
      }),
    )
    const onImported = vi.fn()
    render(<SimpleUploadDialog open onClose={vi.fn()} onImported={onImported} />)
    const upload = screen.getByRole('button', { name: 'Upload' }) as HTMLButtonElement
    expect(upload.disabled).toBe(true)

    await userEvent.upload(screen.getByLabelText('Choose a CSV or Excel file'), new File(['x'], 'cases.csv', { type: 'text/csv' }))
    expect(screen.getByText('cases.csv')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Upload' }))

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Upload complete' })).toBeTruthy())
    expect(screen.getByText('24 new cases added.')).toBeTruthy()
    expect(screen.getByText('50')).toBeTruthy() // 47 already had + 3 different figures left as they are
    expect(screen.queryByText(/not imported/)).toBeNull()
    expect(screen.queryByText(/undo this upload/)).toBeNull()
    // Straight to the save; no corrections applied without a review.
    expect(sent).toEqual([{ url: '/api/admin/sbr/case-imports', corrections: '[]' }])
    expect(onImported).toHaveBeenCalled()
  })

  it('shows a refusal and saves nothing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({ error: 'No usable header row found.' }) })))
    render(<SimpleUploadDialog open onClose={vi.fn()} onImported={vi.fn()} />)
    await userEvent.upload(screen.getByLabelText('Choose a CSV or Excel file'), new File(['x'], 'cases.csv', { type: 'text/csv' }))
    await userEvent.click(screen.getByRole('button', { name: 'Upload' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('No usable header row'))
    expect(screen.queryByRole('heading', { name: 'Upload complete' })).toBeNull()
  })
})
