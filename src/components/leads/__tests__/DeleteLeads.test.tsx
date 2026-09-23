import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, within, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LeadsPageClient } from '../LeadsPageClient'
import { LeadsStoreProvider, type LeadsPersistence } from '../LeadsStore'
import { ToastProvider } from '@/components/ui/Toast'
import { EMPTY_FILTERS } from '@/lib/leads/filter'
import type { Lead } from '@/types/leads'

/**
 * Deleting leads, driven through the real list.
 *
 * The rules that matter here are all about not destroying anything by
 * accident: nothing happens without the dialog, a failed delete leaves the
 * list exactly as it was, and selection never survives a page change — a tick
 * carried across a filter would delete a row the person can no longer see.
 */

const refresh = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh }),
  usePathname: () => '/leads',
}))

afterEach(() => {
  cleanup()
  refresh.mockClear()
})

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
    stageSince: '2026-09-01T00:00:00.000Z',
    lastActionAt: '2026-09-01T00:00:00.000Z',
    convertedClientId: null,
    metaFormId: null,
    metaAdId: null,
    metaAdgroupId: null,
    metaPageId: null,
    metaCampaignId: null,
    metaCampaignName: null,
    metaAdName: null,
    metaAccountId: null,
    metaStateRaw: null,
    metaStateOptions: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  }
}

const MARCUS = makeLead({ id: 'a', name: 'Marcus Oyelaran', email: 'marcus@brightpath.com.au' })
const PRIYA = makeLead({ id: 'b', name: 'Priya Raman', email: 'priya@freight.com.au' })
const CONVERTED = makeLead({
  id: 'c',
  name: 'Sasha Lorenz',
  email: 'sasha@autoworks.com.au',
  stage: 'client',
  convertedClientId: '11111111-1111-4111-8111-111111111111',
})

const LEADS = [MARCUS, PRIYA, CONVERTED]

function renderList(persistence?: LeadsPersistence, leads: Lead[] = LEADS) {
  return render(
    <ToastProvider>
      <LeadsStoreProvider author="Gabby" persistence={persistence}>
        <LeadsPageClient
          filters={EMPTY_FILTERS}
          leads={leads}
          total={leads.length}
          page={1}
          pageCount={1}
          pageSize={10}
        />
      </LeadsStoreProvider>
    </ToastProvider>,
  )
}

function inTable() {
  return within(screen.getByRole('table'))
}

/**
 * The bulk bar's "N leads selected" line.
 *
 * The count sits in its own span so it can be tabular-nums, which splits the
 * text across nodes and puts it out of reach of a plain getByText. Read the
 * whole paragraph instead. Returns null when no bar is showing.
 */
function selectionSummary(): string | null {
  const match = Array.from(document.querySelectorAll('p')).find((node) =>
    /\d+ leads? selected/.test(node.textContent ?? ''),
  )
  return match ? (match.textContent ?? '').replace(/\s+/g, ' ').trim() : null
}

/** The dialog's own confirm button, not the bulk bar's. */
function confirmButton(dialog: HTMLElement, label: RegExp) {
  return within(dialog).getByRole('button', { name: label })
}

describe('deleting from the list', () => {
  it('asks before deleting anything', async () => {
    const user = userEvent.setup()
    const deleteLeads = vi.fn(async () => {})
    renderList({ deleteLeads })

    await user.click(inTable().getByLabelText('Delete Marcus Oyelaran'))

    const dialog = await screen.findByRole('dialog')
    // The email shares its span with a separator, so match loosely.
    expect(within(dialog).getByText(/marcus@brightpath\.com\.au/)).toBeTruthy()
    // Opening the dialog must not have deleted anything yet.
    expect(deleteLeads).not.toHaveBeenCalled()
  })

  it('deletes only the row whose icon was pressed', async () => {
    const user = userEvent.setup()
    const deleteLeads = vi.fn(async () => {})
    renderList({ deleteLeads })

    await user.click(inTable().getByLabelText('Delete Priya Raman'))
    const dialog = await screen.findByRole('dialog')
    await user.click(confirmButton(dialog, /^Delete lead$/))

    await waitFor(() => expect(deleteLeads).toHaveBeenCalledWith({ ids: ['b'] }))
  })

  it('leaves everything alone when cancelled', async () => {
    const user = userEvent.setup()
    const deleteLeads = vi.fn(async () => {})
    renderList({ deleteLeads })

    await user.click(inTable().getByLabelText('Delete Marcus Oyelaran'))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(deleteLeads).not.toHaveBeenCalled()
  })

  it('re-reads the page once the database confirms', async () => {
    // The row has gone, the count has moved and this page may now be past the
    // end — only the server can settle that.
    const user = userEvent.setup()
    renderList({ deleteLeads: async () => {} })

    await user.click(inTable().getByLabelText('Delete Marcus Oyelaran'))
    await user.click(confirmButton(await screen.findByRole('dialog'), /^Delete lead$/))

    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })

  it('keeps the dialog open and says so when the delete fails', async () => {
    const user = userEvent.setup()
    const deleteLeads = vi.fn(async () => {
      throw new Error('Network is down')
    })
    renderList({ deleteLeads })

    await user.click(inTable().getByLabelText('Delete Marcus Oyelaran'))
    const dialog = await screen.findByRole('dialog')
    await user.click(confirmButton(dialog, /^Delete lead$/))

    // Plain DOM assertions — this suite does not load jest-dom matchers.
    const alert = await within(dialog).findByRole('alert')
    expect(alert.textContent).toContain('Network is down')
    // Still on screen, and the list never lost the row.
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(refresh).not.toHaveBeenCalled()
    expect(inTable().getByText('Marcus Oyelaran')).toBeTruthy()
  })

  it('warns that a converted lead leaves its client file behind', async () => {
    // The client file survives — that FK points the other way — but the link
    // back to the lead does not, and that is not obvious from "Are you sure?".
    const user = userEvent.setup()
    renderList({ deleteLeads: async () => {} })

    await user.click(inTable().getByLabelText('Delete Sasha Lorenz'))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/client file in the restructuring workspace/i)).toBeTruthy()
  })

  it('does not warn about a client file for an ordinary lead', async () => {
    const user = userEvent.setup()
    renderList({ deleteLeads: async () => {} })

    await user.click(inTable().getByLabelText('Delete Marcus Oyelaran'))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByText(/client file in the restructuring workspace/i)).toBeNull()
  })
})

describe('selection', () => {
  it('shows no bulk bar until something is ticked', () => {
    renderList()
    expect(screen.queryByRole('button', { name: /^Delete \d+$/ })).toBeNull()
  })

  it('counts what is selected and deletes exactly that', async () => {
    const user = userEvent.setup()
    const deleteLeads = vi.fn(async () => {})
    renderList({ deleteLeads })

    await user.click(inTable().getByLabelText('Select Marcus Oyelaran'))
    await user.click(inTable().getByLabelText('Select Priya Raman'))

    expect(selectionSummary()).toBe('2 leads selected')
    await user.click(screen.getByRole('button', { name: 'Delete 2' }))

    const dialog = await screen.findByRole('dialog')
    await user.click(confirmButton(dialog, /^Delete 2 leads$/))

    await waitFor(() => expect(deleteLeads).toHaveBeenCalledWith({ ids: ['a', 'b'] }))
  })

  it('ticks and clears every row on the page from the header', async () => {
    const user = userEvent.setup()
    renderList()

    const selectAll = inTable().getByLabelText('Select all leads on this page')
    await user.click(selectAll)
    expect(selectionSummary()).toBe('3 leads selected')

    await user.click(inTable().getByLabelText('Clear selection'))
    expect(selectionSummary()).toBeNull()
  })

  it('marks a partial selection as indeterminate, not as empty', async () => {
    // Without this the header box looks identical whether nothing or half the
    // page is ticked.
    const user = userEvent.setup()
    renderList()

    await user.click(inTable().getByLabelText('Select Marcus Oyelaran'))
    const selectAll = inTable().getByLabelText(
      'Select all leads on this page',
    ) as HTMLInputElement
    expect(selectAll.indeterminate).toBe(true)
    expect(selectAll.checked).toBe(false)
  })

  it('drops the selection when the server sends a different page', async () => {
    // A tick carried across a page or filter change would delete a row the
    // person can no longer see.
    const user = userEvent.setup()
    const { rerender } = renderList()

    await user.click(inTable().getByLabelText('Select Marcus Oyelaran'))
    expect(selectionSummary()).toBe('1 lead selected')

    rerender(
      <ToastProvider>
        <LeadsStoreProvider author="Gabby">
          <LeadsPageClient
            filters={EMPTY_FILTERS}
            leads={[PRIYA]}
            total={1}
            page={2}
            pageCount={2}
            pageSize={10}
          />
        </LeadsStoreProvider>
      </ToastProvider>,
    )

    await waitFor(() => expect(selectionSummary()).toBeNull())
  })

  it('does not open the record when a row control is used', async () => {
    // The whole row navigates on click, so the checkbox and the bin have to
    // swallow the event or ticking one would also leave the page.
    const user = userEvent.setup()
    renderList()

    await user.click(inTable().getByLabelText('Select Marcus Oyelaran'))
    expect(selectionSummary()).toBe('1 lead selected')
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
