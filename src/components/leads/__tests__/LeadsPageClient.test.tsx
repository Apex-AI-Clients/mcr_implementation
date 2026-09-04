import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, within, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LeadsPageClient } from '../LeadsPageClient'
import { LeadsStoreProvider } from '../LeadsStore'
import { ToastProvider } from '@/components/ui/Toast'
import type { Lead } from '@/types/leads'

/**
 * Smoke test for the leads list.
 *
 * Verifies the behaviours that can't be read off the markup — debounced search,
 * additive filters, the follow-up toggle, the empty states and the add-lead
 * dialog's shape. Rendering is the only way to check these short of a browser.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/leads',
}))

afterEach(cleanup)

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
    createdAt: daysAgo(5),
    updatedAt: daysAgo(5),
    ...overrides,
  }
}

const LEADS: Lead[] = [
  makeLead({ id: 'a', name: 'Marcus Oyelaran', email: 'marcus@brightpath.com.au', phone: '0402915338', state: 'VIC', createdAt: daysAgo(2), lastActionAt: daysAgo(2) }),
  makeLead({ id: 'b', name: 'Priya Raman', email: 'priya@freight.com.au', phone: '0433217604', state: 'NSW', stage: 'prospect', source: 'website', createdAt: daysAgo(9), lastActionAt: daysAgo(9) }),
  // Open and long overdue — this is the one the follow-up toggle should keep.
  makeLead({ id: 'c', name: 'Sasha Lorenz', email: 'sasha@autoworks.com.au', phone: '0421004772', createdAt: daysAgo(50), lastActionAt: daysAgo(45) }),
  // Closed and long overdue — must never flag.
  makeLead({ id: 'd', name: 'Hugo Pemberton', email: 'hugo@tiling.com.au', phone: '0417645099', stage: 'non_proceeding', createdAt: daysAgo(80), lastActionAt: daysAgo(75) }),
]

function renderList(leads: Lead[] = LEADS) {
  return render(
    <ToastProvider>
      <LeadsStoreProvider initialLeads={leads} initialActivities={[]} author="Gabby">
        <LeadsPageClient />
      </LeadsStoreProvider>
    </ToastProvider>,
  )
}

/**
 * Queries scoped to the desktop table.
 *
 * The table and the sub-md card list are both in the DOM at once — the split is
 * pure CSS, and jsdom applies none — so an unscoped query matches every lead
 * twice.
 */
function inTable() {
  return within(screen.getByRole('table'))
}

/** Lead names currently rendered in the desktop table. */
function visibleNames(): string[] {
  const table = screen.queryByRole('table')
  if (!table) return []
  return within(table)
    .getAllByRole('row')
    .slice(1) // drop the header row
    .map((row) => within(row).getAllByRole('cell')[1].textContent ?? '')
}

describe('LeadsPageClient', () => {
  it('lists every lead, newest first', () => {
    renderList()
    expect(visibleNames()).toEqual([
      'Marcus Oyelaran',
      'Priya Raman',
      'Sasha Lorenz',
      'Hugo Pemberton',
    ])
  })

  it('summarises the lead count, without the follow-up count for now', () => {
    renderList()
    const summary = screen.getByRole('heading', { name: 'Leads' }).parentElement?.textContent ?? ''
    expect(summary).toContain('4 leads')
    // The follow-up count is commented out in LeadsPageClient along with the
    // table column, the filter toggle and the top-bar pill.
    expect(summary).not.toMatch(/follow-up/i)
  })

  it('filters by search after the debounce', async () => {
    const user = userEvent.setup()
    renderList()

    await user.type(screen.getByLabelText('Search leads'), 'priya')
    await waitFor(() => expect(visibleNames()).toEqual(['Priya Raman']))
  })

  it('searches phone numbers regardless of formatting', async () => {
    const user = userEvent.setup()
    renderList()

    await user.type(screen.getByLabelText('Search leads'), '0402 915')
    await waitFor(() => expect(visibleNames()).toEqual(['Marcus Oyelaran']))
  })

  // Skipped while the follow-up toggle is commented out in LeadFilters. The
  // rule itself stays covered by followUp.test.ts and filter.test.ts; unskip
  // this when the toggle comes back.
  it.skip('narrows to flagged leads with the follow-up toggle, excluding closed ones', async () => {
    const user = userEvent.setup()
    renderList()

    await user.click(screen.getByRole('switch', { name: /follow-up/i }))
    await waitFor(() => expect(visibleNames()).toEqual(['Sasha Lorenz']))
  })

  it('combines filters additively', async () => {
    const user = userEvent.setup()
    renderList()

    await user.selectOptions(screen.getByLabelText('Filter by state'), 'NSW')
    await waitFor(() => expect(visibleNames()).toEqual(['Priya Raman', 'Sasha Lorenz', 'Hugo Pemberton']))

    await user.selectOptions(screen.getByLabelText('Filter by stage'), 'prospect')
    await waitFor(() => expect(visibleNames()).toEqual(['Priya Raman']))
  })

  it('offers a reset from the filtered empty state', async () => {
    const user = userEvent.setup()
    renderList()

    await user.type(screen.getByLabelText('Search leads'), 'nobody at all')
    await waitFor(() => expect(screen.getByText('No leads match these filters')).toBeTruthy())

    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    await waitFor(() => expect(visibleNames()).toHaveLength(4))
  })

  it('explains where leads come from when there are none at all', () => {
    renderList([])
    expect(screen.getByText(/They.ll arrive here from Facebook and the website/)).toBeTruthy()
    expect(screen.queryByText('No leads match these filters')).toBeNull()
  })

  it('changes a stage from inside the row', async () => {
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

  it('adds a valid lead to the top of the list as a manual source', async () => {
    const user = userEvent.setup()
    renderList()

    await user.click(screen.getByRole('button', { name: /add lead/i }))
    const dialog = await screen.findByRole('dialog')

    await user.type(within(dialog).getByLabelText('Name'), 'Dean Whitlock')
    await user.type(within(dialog).getByLabelText('Email'), 'dean@whitlockcivil.com.au')
    await user.type(within(dialog).getByLabelText('Phone'), '0407 552 118')
    // "$150k – $250k" is index 7 in DEBT_PRESETS.
    await user.selectOptions(within(dialog).getByLabelText('Debt'), '7')
    await user.selectOptions(within(dialog).getByLabelText('State'), 'QLD')
    await user.selectOptions(within(dialog).getByLabelText(/Business type/), 'trust')
    await user.type(
      within(dialog).getByLabelText(/Their message/),
      'Civil contracting, mostly PAYG.',
    )
    await user.click(within(dialog).getByRole('button', { name: 'Add lead' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(visibleNames()[0]).toBe('Dean Whitlock')
    // Debt is a select in the row now, so assert its value rather than text:
    // every row carries every preset label as an <option>.
    const debt = inTable().getByLabelText('Debt for Dean Whitlock') as HTMLSelectElement
    expect(debt.value).toBe('150000:250000')
    expect(inTable().getByText('Trust')).toBeTruthy()
    expect(inTable().getByText('Civil contracting, mostly PAYG.')).toBeTruthy()
  })

  it('asks for confirmation before converting rather than changing stage outright', async () => {
    const user = userEvent.setup()
    renderList()

    const select = inTable().getByLabelText('Stage for Marcus Oyelaran') as HTMLSelectElement
    await user.selectOptions(select, 'client')

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/creates a client file for Marcus Oyelaran/)).toBeTruthy()
    // Not committed until the dialog is confirmed.
    expect(select.value).toBe('lead')
  })
})
