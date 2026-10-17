import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, within, cleanup } from '@testing-library/react'

vi.mock('@/lib/supabase/server', () => ({ getSupabaseServerClient: vi.fn() }))
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('notFound')
  },
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`)
  },
}))
vi.mock('@/lib/dpn/view', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/dpn/view')>()),
  sydneyToday: () => '2026-10-17',
}))

import { getSupabaseServerClient } from '@/lib/supabase/server'
import DirectorPenaltyNoticesPage from '../page'
import type { NoticeRow } from '@/lib/dpn/stored'

/** The DPN summary page, against a mocked database. Synthetic data only. */

afterEach(() => cleanup())

const CLIENT = { id: 'cl_1', name: 'Example Trading', archived_at: null }

function noticeRow(overrides: Partial<NoticeRow>): NoticeRow {
  return {
    id: 'n1',
    client_id: 'cl_1',
    document_id: 'd1',
    source: 'parsed',
    status: 'read',
    manual_reason: null,
    review_reasons: [],
    reference: '1234567890123',
    issued_on: '2026-09-30',
    notice_type: 'paygw',
    company_name: 'EXAMPLE TRADING PTY LTD',
    acn: '000000019',
    director_name: 'Jane Sample',
    rows: [{ periodFrom: '2025-01-01', periodTo: '2025-03-31', column2: 100000, column3: 100000, column4: 60000, column5: 40000 }],
    total_column2: 100000,
    total_column3: 100000,
    total_column4: 60000,
    total_column5: 40000,
    parser_version: 1,
    entered_by: null,
    entered_at: null,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
    ...overrides,
  }
}

/** Each table answers whatever chain the page builds, with its own result. */
function mockDb(results: Record<string, unknown>) {
  const chain = (result: unknown): Record<string, unknown> => {
    const node: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'order']) node[m] = () => node
    node.single = () => Promise.resolve(result)
    node.maybeSingle = () => Promise.resolve(result)
    node.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve)
    return node
  }
  vi.mocked(getSupabaseServerClient).mockReturnValue({
    from: (table: string) => chain(results[table]),
  } as never)
}

async function renderPage(notices: NoticeRow[], docs = [{ id: 'd1', original_filename: 'notice.pdf' }]) {
  mockDb({
    clients: { data: CLIENT },
    documents: { data: docs },
    director_penalty_notices: { data: notices },
    company_details: { data: { acn_number: '000000019', directors: [{ name: 'Jane Sample', dateOfBirth: null }] } },
  })
  render(await DirectorPenaltyNoticesPage({ params: Promise.resolve({ id: 'cl_1' }) }))
}

describe('Director penalty notices page', () => {
  it('shows the company totals with the notice wording and the deadline', async () => {
    await renderPage([noticeRow({})])
    const company = screen.getByRole('region', { name: 'What the company owes, by type' })
    expect(within(company).getByText('PAYG withholding')).toBeTruthy()
    expect(within(company).getByText('Unpaid')).toBeTruthy()
    expect(
      within(company).getByText(
        'Removed if the company appoints an SBR practitioner, administrator or liquidator, or pays, by 21 Oct 2026',
      ),
    ).toBeTruthy()
    expect(within(company).getByText('Stays with the director unless paid')).toBeTruthy()
    expect(within(company).getAllByText('$1,000.00').length).toBeGreaterThan(0)
  })

  it('lists notices as current or history, with days left and how each was read', async () => {
    await renderPage(
      [
        noticeRow({}),
        noticeRow({ id: 'n2', document_id: 'd2', issued_on: '2026-03-01', source: 'manual', entered_by: 'Sam', entered_at: '2026-03-02T00:00:00Z' }),
      ],
      [
        { id: 'd1', original_filename: 'new.pdf' },
        { id: 'd2', original_filename: 'old.pdf' },
      ],
    )
    const rows = within(screen.getByRole('region', { name: 'Notices' })).getAllByRole('row').slice(1)
    expect(within(rows[0]).getByText('Current')).toBeTruthy()
    expect(within(rows[0]).getByText('4 days left')).toBeTruthy()
    expect(within(rows[0]).getByText('Read automatically')).toBeTruthy()
    expect(within(rows[1]).getByText('History')).toBeTruthy()
    expect(within(rows[1]).getByText('Entered manually')).toBeTruthy()
  })

  it('lists files not in the totals, and says where the figures come from', async () => {
    await renderPage([noticeRow({})], [
      { id: 'd1', original_filename: 'notice.pdf' },
      { id: 'd9', original_filename: 'unread.pdf' },
    ])
    expect(within(screen.getByRole('region', { name: 'Not in the totals' })).getByText('unread.pdf')).toBeTruthy()
    expect(screen.getByText(/Figures come from ATO director penalty notices supplied by the client/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /CSV/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /PDF/ })).toBeTruthy()
  })

  it('says so when there are none, or none were issued', async () => {
    await renderPage([], [])
    expect(screen.getByText('No director penalty notices uploaded.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /CSV/ })).toBeNull()
  })
})
