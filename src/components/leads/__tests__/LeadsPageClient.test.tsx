import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, within, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LeadsPageClient } from '../LeadsPageClient'
import { LeadsStoreProvider } from '../LeadsStore'
import { ToastProvider } from '@/components/ui/Toast'
import { EMPTY_FILTERS, type LeadFilterState } from '@/lib/leads/filter'
import type { Lead } from '@/types/leads'

/**
 * Smoke test for the leads list.
 *
 * Paging, filtering and sorting happen in Postgres now, so what this asserts
 * has changed shape: not "which rows survive a filter" — that is
 * queries.ts's job and filter.test.ts still covers the predicate — but that
 * every control puts the right thing in the URL, and that the table renders
 * the page the server sent. The URL is the contract between the two.
 */

const replace = vi.fn()
const push = vi.fn()
const refresh = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace, refresh }),
  usePathname: () => '/leads',
}))

afterEach(() => {
  cleanup()
  replace.mockClear()
  push.mockClear()
  refresh.mockClear()
})

const DAY_MS = 86_400_000
function daysAgo(n: number): string {
  return new Date(Date.now() - n * DAY_MS).toISOString()
}

function makeLead(overrides: Partial<Lead>): Lead {
  return {
    id: 'ld_x',
    name: 'Placeholder',
    email: 'placeholder@example.com.au',
    phone: '0400000000',
    debtMin: 100_000,
    debtMax: 124_999,
    entityType: 'company',
    message: null,
    preferredCallTime: null,
    state: 'NSW',
    stage: 'lead',
    source: 'facebook',
    company: null,
    nextStep: null,
    stageSince: daysAgo(5),
    lastActionAt: daysAgo(5),
    convertedClientId: null,
    metaFormId: null,
    metaAdId: null,
    metaAdgroupId: null,
    metaPageId: null,
    metaCampaignId: null,
    metaCampaignName: null,
    metaAdName: null,
    metaAccountId: null,
    createdAt: daysAgo(5),
    updatedAt: daysAgo(5),
    ...overrides,
  }
}

const LEADS: Lead[] = [
  makeLead({ id: 'a', name: 'Marcus Oyelaran', email: 'marcus@brightpath.com.au', phone: '0402915338', state: 'VIC', createdAt: daysAgo(2) }),
  makeLead({ id: 'b', name: 'Priya Raman', email: 'priya@freight.com.au', phone: '0433217604', stage: 'prospect', source: 'website', createdAt: daysAgo(9) }),
  makeLead({ id: 'c', name: 'Sasha Lorenz', email: 'sasha@autoworks.com.au', phone: '0421004772', createdAt: daysAgo(50) }),
  makeLead({ id: 'd', name: 'Hugo Pemberton', email: 'hugo@tiling.com.au', phone: '0417645099', stage: 'non_proceeding', createdAt: daysAgo(80) }),
]

interface RenderOptions {
  leads?: Lead[]
  filters?: Partial<LeadFilterState>
  total?: number
  page?: number
  pageCount?: number
}

function renderList(options: RenderOptions = {}) {
  const leads = options.leads ?? LEADS
  return render(
    <ToastProvider>
      <LeadsStoreProvider author="Gabby">
        <LeadsPageClient
          filters={{ ...EMPTY_FILTERS, ...options.filters }}
          leads={leads}
          total={options.total ?? leads.length}
          page={options.page ?? 1}
          pageCount={options.pageCount ?? 1}
          pageSize={10}
        />
      </LeadsStoreProvider>
    </ToastProvider>,
  )
}

/**
 * Queries scoped to the desktop table.
 *
 * The table and the sub-md card list are both in the DOM at once — the split
 * is pure CSS, and jsdom applies none — so an unscoped query matches every
 * lead twice.
 */
function inTable() {
  return within(screen.getByRole('table'))
}

/**
 * Lead names currently rendered in the desktop table.
 *
 * Read off the row's link rather than a cell index — the name is the only
 * link in a row, and an index breaks every time a column is added at the
 * left, which is exactly what selection and delete did.
 */
function visibleNames(): string[] {
  const table = screen.queryByRole('table')
  if (!table) return []
  return within(table)
    .getAllByRole('row')
    .slice(1) // drop the header row
    .map((row) => within(row).queryByRole('link')?.textContent ?? '')
}

/**
 * The wide run of page numbers.
 *
 * Pagination renders two lists — a wide one and a narrow one — and the
 * breakpoint shows exactly one. A real browser exposes only the visible list
 * (the other is display:none, which screen readers skip), but jsdom applies no
 * CSS, so an unscoped query matches both.
 */
function inPagination() {
  const nav = screen.getByRole('navigation', { name: 'Pagination' })
  const wide = nav.querySelectorAll('ol')[0] as HTMLElement
  return { nav, wide: within(wide) }
}

/** The path the last navigation asked for. */
function lastReplace(): string {
  expect(replace).toHaveBeenCalled()
  return replace.mock.calls[replace.mock.calls.length - 1][0] as string
}

describe('LeadsPageClient', () => {
  it('renders the page the server sent, in the order it sent it', () => {
    // No client-side sort: the database ordered these and the table must not
    // second-guess it.
    renderList()
    expect(visibleNames()).toEqual([
      'Marcus Oyelaran',
      'Priya Raman',
      'Sasha Lorenz',
      'Hugo Pemberton',
    ])
  })

  it('counts every matching lead, not the rows on screen', () => {
    // 10 rows of 47 must still say 47, or the number means nothing.
    renderList({ leads: LEADS, total: 47, pageCount: 5 })
    const summary = screen.getByRole('heading', { name: 'Leads' }).parentElement?.textContent ?? ''
    expect(summary).toContain('47 leads')
  })

  it('puts the search term in the URL after the debounce', async () => {
    const user = userEvent.setup()
    renderList()

    await user.type(screen.getByLabelText('Search leads'), 'priya')
    await waitFor(() => expect(lastReplace()).toBe('/leads?q=priya'))
  })

  it('does not navigate on every keystroke', async () => {
    const user = userEvent.setup()
    renderList()

    await user.type(screen.getByLabelText('Search leads'), 'priya')
    await waitFor(() => expect(replace).toHaveBeenCalled())
    // Five characters, one navigation — otherwise every letter is a query.
    expect(replace).toHaveBeenCalledTimes(1)
  })

  it('offers only the sources that can actually arrive', async () => {
    // No live form posts as google_form, so offering it is a filter that can
    // only ever return nothing. The other three stay.
    renderList()
    const source = screen.getByLabelText('Filter by source')
    const options = Array.from(source.querySelectorAll('option')).map((o) => o.textContent)

    expect(options).not.toContain('Google Form')
    expect(options).toEqual(
      expect.arrayContaining(['Facebook', 'Website', 'Added manually']),
    )
  })

  it('carries a filter into the URL', async () => {
    const user = userEvent.setup()
    renderList()

    await user.selectOptions(screen.getByLabelText('Filter by state'), 'NSW')
    await waitFor(() => expect(lastReplace()).toBe('/leads?state=NSW'))
  })

  it('keeps existing filters when another one changes', async () => {
    const user = userEvent.setup()
    renderList({ filters: { state: 'NSW' } })

    await user.selectOptions(screen.getByLabelText('Filter by stage'), 'prospect')
    const href = lastReplace()
    expect(href).toContain('state=NSW')
    expect(href).toContain('stage=prospect')
  })

  it('returns to page 1 when a filter changes', async () => {
    // Staying on page 7 of a result set that now has two pages shows an empty
    // table for a filter that matched plenty.
    const user = userEvent.setup()
    renderList({ page: 7, pageCount: 9, total: 84 })

    await user.selectOptions(screen.getByLabelText('Filter by state'), 'NSW')
    expect(lastReplace()).not.toContain('page=')
  })

  it('clears everything back to a bare /leads', async () => {
    const user = userEvent.setup()
    renderList({ leads: [], total: 0, filters: { search: 'nobody at all' } })

    expect(screen.getByText('No leads match these filters')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(lastReplace()).toBe('/leads')
  })

  it('explains where leads come from when there are none at all', () => {
    renderList({ leads: [], total: 0 })
    expect(screen.getByText(/They.ll arrive here from Facebook and the website/)).toBeTruthy()
    expect(screen.queryByText('No leads match these filters')).toBeNull()
  })

  it('shows no pagination for a single page', () => {
    renderList()
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).toBeNull()
  })

  it('shows pagination once there is more than one page', () => {
    renderList({ total: 47, page: 1, pageCount: 5 })
    const { nav, wide } = inPagination()
    expect(wide.getByRole('link', { name: 'Page 2' })).toBeTruthy()
    expect(within(nav).getAllByText('1–10 of 47').length).toBeGreaterThan(0)
  })

  it('keeps the filters in every page link', () => {
    // A page link that drops the filter silently widens the result set.
    renderList({ total: 47, page: 2, pageCount: 5, filters: { state: 'NSW', search: 'civil' } })
    const href = inPagination().wide.getByRole('link', { name: 'Page 3' }).getAttribute('href') ?? ''
    expect(href).toContain('page=3')
    expect(href).toContain('state=NSW')
    expect(href).toContain('q=civil')
  })

  it('marks the current page for assistive tech, not just with colour', () => {
    renderList({ total: 47, page: 2, pageCount: 5 })
    expect(
      inPagination().wide.getByRole('link', { name: 'Page 2' }).getAttribute('aria-current'),
    ).toBe('page')
  })

  it('offers no Previous on the first page', () => {
    renderList({ total: 47, page: 1, pageCount: 5 })
    const nav = screen.getByRole('navigation', { name: 'Pagination' })
    expect(within(nav).queryByRole('link', { name: 'Previous page' })).toBeNull()
    expect(within(nav).getByRole('link', { name: 'Next page' })).toBeTruthy()
  })

  it('offers no Next on the last page', () => {
    renderList({ total: 47, page: 5, pageCount: 5 })
    const nav = screen.getByRole('navigation', { name: 'Pagination' })
    expect(within(nav).getByRole('link', { name: 'Previous page' })).toBeTruthy()
    expect(within(nav).queryByRole('link', { name: 'Next page' })).toBeNull()
  })

  it('changes a stage from inside the row', async () => {
    // The row renders from server data but reads through the store, so an
    // optimistic edit has to show without a round trip.
    const user = userEvent.setup()
    renderList()

    const select = inTable().getByLabelText('Stage for Marcus Oyelaran')
    await user.selectOptions(select, 'prospect')
    await waitFor(() => expect((select as HTMLSelectElement).value).toBe('prospect'))
  })

  it('groups the stage select into Pipeline and Closed', () => {
    renderList()
    const select = inTable().getByLabelText('Stage for Marcus Oyelaran')
    const groups = Array.from(select.querySelectorAll('optgroup')).map((g) => g.label)
    expect(groups).toEqual(['Pipeline', 'Closed'])
  })

  it('opens the add-lead dialog with no company field', async () => {
    const user = userEvent.setup()
    renderList()

    await user.click(screen.getByRole('button', { name: /add lead/i }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText('Name')).toBeTruthy()
    expect(within(dialog).getByLabelText('Email')).toBeTruthy()
    expect(within(dialog).getByLabelText('Phone')).toBeTruthy()
    expect(within(dialog).getByLabelText('Debt')).toBeTruthy()
    expect(within(dialog).getByLabelText('State')).toBeTruthy()
    expect(within(dialog).getByLabelText(/Business type/)).toBeTruthy()
    expect(within(dialog).getByLabelText(/Their message/)).toBeTruthy()
    // Deliberately absent — it is off the public capture form.
    expect(within(dialog).queryByLabelText(/^Company$/i)).toBeNull()
  })

  it('reports validation errors under the fields, not in a banner', async () => {
    const user = userEvent.setup()
    renderList()

    await user.click(screen.getByRole('button', { name: /add lead/i }))
    const dialog = await screen.findByRole('dialog')

    await user.type(within(dialog).getByLabelText('Email'), 'not-an-email')
    await user.type(within(dialog).getByLabelText('Phone'), '0312345678')
    await user.click(within(dialog).getByRole('button', { name: 'Add lead' }))

    expect(within(dialog).getByText('Enter a name.')).toBeTruthy()
    expect(within(dialog).getByText('That email address does not look right.')).toBeTruthy()
    expect(within(dialog).getByText(/Australian mobile/)).toBeTruthy()
    expect(within(dialog).getByText('Choose a debt range.')).toBeTruthy()
    expect(within(dialog).getByText('Choose a state.')).toBeTruthy()
  })

  it('sends you to an unfiltered page 1 after adding a lead', async () => {
    // The new row is optimistic and not in the page the server sent, so it
    // would not appear where you are. Page 1 sorts newest first, which is
    // where it belongs.
    const user = userEvent.setup()
    renderList({ filters: { state: 'NSW' }, page: 3, pageCount: 4, total: 34 })

    await user.click(screen.getByRole('button', { name: /add lead/i }))
    const dialog = await screen.findByRole('dialog')

    await user.type(within(dialog).getByLabelText('Name'), 'Dean Whitlock')
    await user.type(within(dialog).getByLabelText('Email'), 'dean@whitlockcivil.com.au')
    await user.type(within(dialog).getByLabelText('Phone'), '0407 552 118')
    // "$150k – $250k" is index 7 in DEBT_PRESETS.
    await user.selectOptions(within(dialog).getByLabelText('Debt'), '7')
    await user.selectOptions(within(dialog).getByLabelText('State'), 'QLD')
    await user.click(within(dialog).getByRole('button', { name: 'Add lead' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(push).toHaveBeenCalledWith('/leads')
    expect(refresh).toHaveBeenCalled()
  })
})
