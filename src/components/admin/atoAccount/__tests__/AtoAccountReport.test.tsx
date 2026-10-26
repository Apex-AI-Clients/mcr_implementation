import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AtoAccountReport } from '../AtoAccountReport'
import { analyseAtoAccount } from '@/lib/analysis/atoAccount'
import type { AtoAccountPayload } from '@/lib/analysis/atoAccount/exportCsv'

/** The income tax and super guarantee page. Synthetic exports only. */

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
vi.mock('@/components/admin/ExportPdfButton', () => ({
  ExportPdfButton: ({ lockedReason }: { lockedReason?: string | null }) => (
    <button type="button" disabled={Boolean(lockedReason)}>
      Export PDF
    </button>
  ),
}))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const HEADER = 'Processed date,Effective date,Description,Debit (DR),Credit (CR),Balance'
const SG = [
  '"Superannuation guarantee employer 005"',
  '"OTHER CONTRACTORS PTY LTD"',
  HEADER,
  `"17 Sep 2026","20 Jul 2026","'Tax Office audit amended SGC Statement (Liability) - Superannuation Guarantee (Quarterly) for the period from 01 Jul 21 to 30 Sep 21","","$0.00","$7,000.00 DR"`,
  `"16 Sep 2026","16 Sep 2026","'SGC Statement (Liability) - SG Shortfall for the period from 01 Jul 21 to 30 Sep 21","$5,000.00","","$7,000.00 DR"`,
  `"16 Sep 2026","16 Sep 2026","'Default SGC Statement (Liability) - Superannuation Guarantee (Quarterly) for the period from 01 Jul 21 to 30 Sep 21","","$0.00","$2,000.00 DR"`,
  `"01 Sep 2026","01 Sep 2026","'Something not recognised","$2,000.00","","$2,000.00 DR"`,
  // An older row, so the unrecognised charge is not taken as the balance brought forward.
  `"01 Aug 2026","01 Aug 2026","'General interest charge calculated from 01 Jul 26 to 31 Jul 26","$0.00","","$0.00"`,
].join('\n')

function payload(over: Partial<AtoAccountPayload> = {}): AtoAccountPayload {
  const a = analyseAtoAccount(SG)
  return {
    id: 'an-1',
    clientId: 'c1',
    kind: a.kind,
    label: a.label,
    entityName: a.entityName,
    entityMatches: false,
    sourceFilename: null,
    balance: a.balance,
    balanceDate: a.balanceDate,
    unexplained: a.unexplainedDifference,
    needsReview: a.needsReview,
    reviewedBy: null,
    reviewedAt: null,
    analysedAt: '2026-10-26T00:00:00Z',
    composition: a.composition,
    summary: a.summary,
    ...over,
  } as AtoAccountPayload
}

describe('AtoAccountReport', () => {
  it('locks both exports until the unexplained difference is reviewed, then records the review', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }))
    vi.stubGlobal('fetch', fetchMock)
    render(<AtoAccountReport payload={payload()} clientName="Example Trading" />)

    expect(screen.getByText('Needs review')).toBeTruthy()
    expect((screen.getByRole('button', { name: /Export CSV/ }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: /Export PDF/ }) as HTMLButtonElement).disabled).toBe(true)

    await userEvent.click(screen.getByRole('button', { name: 'Mark as reviewed' }))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/clients/c1/ato-accounts/an-1/review', { method: 'POST' })
  })

  it('unlocks once reviewed, and says who reviewed it', () => {
    render(<AtoAccountReport payload={payload({ reviewedAt: '2026-10-26T01:00:00Z', reviewedBy: 'Staff Member' })} clientName="Example Trading" />)
    expect(screen.queryByText('Needs review')).toBeNull()
    expect((screen.getByRole('button', { name: /Export CSV/ }) as HTMLButtonElement).disabled).toBe(false)
    expect(screen.getByText(/reviewed by Staff Member on 26 Oct 2026/)).toBeTruthy()
  })

  it('heads each quarter with its latest event, highlights the ATO raising it, and warns of another entity', () => {
    render(<AtoAccountReport payload={payload()} clientName="Example Trading" />)
    expect(screen.getAllByText('ATO audit').length).toBeGreaterThan(0)
    expect(screen.getByText(/This account is for OTHER CONTRACTORS PTY LTD/)).toBeTruthy()
    expect(screen.getByText('Unpaid superannuation guarantee charge can be the subject of a director penalty notice.')).toBeTruthy()
    expect(screen.queryByText(/lodged by the company/i)).toBeNull()
  })

  it('asks for the AI summary once unlocked, and shows it', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ aiSummary: 'The account shows $7,000 owed.', aiSummaryGeneratedAt: '2026-10-26T00:00:00Z' }) }))
    vi.stubGlobal('fetch', fetchMock)
    render(<AtoAccountReport payload={payload({ reviewedAt: '2026-10-26T01:00:00Z' })} clientName="Example Trading" />)
    expect(await screen.findByText('The account shows $7,000 owed.')).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/clients/c1/ato-accounts/an-1/summary', { method: 'POST' })
  })

  it('does not ask for one while locked', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    render(<AtoAccountReport payload={payload()} clientName="Example Trading" />)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

