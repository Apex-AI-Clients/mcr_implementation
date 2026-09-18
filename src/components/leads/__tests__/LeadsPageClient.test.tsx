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
    // Debt is a typed figure in the row; the display carries the formatted range.
    expect(inTable().getByLabelText('Edit debt for Dean Whitlock').textContent).toContain(
      '$150k \u2013 $250k',
    )
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

describe('editing debt in the row', () => {
  /** Open the row's debt editor and return its input. */
  async function openDebt(user: ReturnType<typeof userEvent.setup>, name: string) {
    await user.click(inTable().getByLabelText(`Edit debt for ${name}`))
    return inTable().getByLabelText(`Debt for ${name}`) as HTMLInputElement
  }

  it('shows the stored range until it is edited', () => {
    renderList()
    // Fixture 'a' is 50,000-74,999.
    expect(inTable().getByLabelText('Edit debt for Marcus Oyelaran').textContent).toContain(
      '$100k \u2013 $125k',
    )
  })

  it('accepts an exact figure and stores it as a point amount', async () => {
    const user = userEvent.setup()
    renderList()

    const input = await openDebt(user, 'Marcus Oyelaran')
    await user.type(input, '63500')
    await user.keyboard('{Enter}')

    // min === max, so it renders as one amount rather than a range.
    await waitFor(() =>
      expect(inTable().getByLabelText('Edit debt for Marcus Oyelaran').textContent).toContain(
        '$64k',
      ),
    )
  })

  it.each([
    ['$120,000', '$120k'],
    ['120k', '$120k'],
    ['120000', '$120k'],
  ])('accepts %s', async (typed, expected) => {
    const user = userEvent.setup()
    renderList()

    const input = await openDebt(user, 'Marcus Oyelaran')
    await user.type(input, typed)
    await user.keyboard('{Enter}')

    await waitFor(() =>
      expect(inTable().getByLabelText('Edit debt for Marcus Oyelaran').textContent).toContain(
        expected,
      ),
    )
  })

  it('does not prefill the editor from a bracket, so Enter cannot silently pin it', async () => {
    const user = userEvent.setup()
    renderList()

    // 'a' holds a bracket (100,000-124,999), not an exact figure.
    const input = await openDebt(user, 'Marcus Oyelaran')
    expect(input.value).toBe('')
    // The current range is offered as a placeholder for context only.
    expect(input.placeholder).toContain('$100k')
  })

  it('prefills the editor when the stored value is already exact', async () => {
    const user = userEvent.setup()
    renderList()

    let input = await openDebt(user, 'Marcus Oyelaran')
    await user.type(input, '63500')
    await user.keyboard('{Enter}')
    await waitFor(() =>
      expect(inTable().queryByLabelText('Debt for Marcus Oyelaran')).toBeNull(),
    )

    input = await openDebt(user, 'Marcus Oyelaran')
    expect(input.value).toBe('63500')
  })

  it('clears the debt when the field is emptied', async () => {
    const user = userEvent.setup()
    renderList()

    const input = await openDebt(user, 'Marcus Oyelaran')
    await user.clear(input)
    await user.keyboard('{Enter}')

    await waitFor(() =>
      expect(inTable().getByLabelText('Edit debt for Marcus Oyelaran').textContent).toContain(
        '\u2014',
      ),
    )
  })

  it.each([
    ['not sure', /Enter an amount/],
    ['50k to 100k', /one amount, not a range/],
    ['3', /at least \$1,000/],
  ])('refuses %s with a reason rather than guessing', async (typed, message) => {
    const user = userEvent.setup()
    renderList()

    const input = await openDebt(user, 'Marcus Oyelaran')
    await user.type(input, typed)
    await user.keyboard('{Enter}')

    expect(inTable().getByText(message)).toBeTruthy()
    // Still editing, and the stored value is untouched.
    expect(inTable().getByLabelText('Debt for Marcus Oyelaran')).toBeTruthy()
  })

  it('abandons the edit on Escape', async () => {
    const user = userEvent.setup()
    renderList()

    const input = await openDebt(user, 'Marcus Oyelaran')
    await user.type(input, '999999')
    await user.keyboard('{Escape}')

    await waitFor(() =>
      expect(inTable().getByLabelText('Edit debt for Marcus Oyelaran').textContent).toContain(
        '$100k \u2013 $125k',
      ),
    )
  })

  it('does not open the record when the editor is used', async () => {
    const user = userEvent.setup()
    renderList()

    // The row is clickable; the control inside it must not trigger that.
    await user.click(inTable().getByLabelText('Edit debt for Marcus Oyelaran'))
    expect(inTable().getByLabelText('Debt for Marcus Oyelaran')).toBeTruthy()
  })
})
