import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, within, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LeadsPageClient } from '../LeadsPageClient'
import { LeadsStoreProvider, type LeadsPersistence } from '../LeadsStore'
import { ToastProvider } from '@/components/ui/Toast'
import { EMPTY_FILTERS } from '@/lib/leads/filter'
import type { Lead } from '@/types/leads'

/**
 * Typing a lead's source in the table, like the debt. Driven through the real
 * list so the store and the save are exercised. Synthetic data only.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/leads',
}))

afterEach(() => cleanup())

const LEAD = {
  id: 'ld_1',
  name: 'Dean Sample',
  email: 'dean@example.test',
  phone: '0400000001',
  debtMin: null,
  debtMax: null,
  state: 'QLD',
  metaStateRaw: null,
  metaStateOptions: null,
  entityType: 'company',
  message: null,
  preferredCallTime: null,
  stage: 'prospect',
  source: 'facebook',
  sourceLabel: null,
  company: null,
  nextStep: null,
  stageSince: '2026-09-01T00:00:00.000Z',
  lastActionAt: '2026-09-01T00:00:00.000Z',
  lastEnquiryAt: '2026-09-01T00:00:00.000Z',
  enquiryCount: 1,
  latestEnquirySource: null,
  reenquiredAfterCloseAt: null,
  reenquiryDismissedAt: null,
  reenquiryDismissedBy: null,
  convertedClientId: null,
  metaCampaignName: 'MCR26 EPICDM Q4',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
} as unknown as Lead

function renderList(persistence: LeadsPersistence, lead: Lead = LEAD) {
  render(
    <ToastProvider>
      <LeadsStoreProvider
        initialLeads={[lead]}
        initialActivities={[]}
        author="Tester"
        persistence={persistence}
      >
        <LeadsPageClient
          filters={EMPTY_FILTERS}
          leads={[lead]}
          total={1}
          page={1}
          pageCount={1}
          pageSize={10}
        />
      </LeadsStoreProvider>
    </ToastProvider>,
  )
  return screen.getByRole('table')
}

const editButton = (table: HTMLElement) =>
  within(table).getByRole('button', { name: 'Edit source for Dean Sample' })

describe('SourceInput', () => {
  it('shows the source with its partner, and takes any typed source', async () => {
    const user = userEvent.setup()
    const updateLead = vi.fn(async () => {})
    const table = renderList({ updateLead })

    expect(editButton(table).textContent).toBe('Facebook · EPIC DM')

    await user.click(editButton(table))
    const input = within(table).getByLabelText('Source for Dean Sample') as HTMLInputElement
    expect(input.value).toBe('')
    expect(input.placeholder).toBe('Facebook · EPIC DM')
    await user.type(input, '  Referral from Dave {Enter}')

    expect(updateLead).toHaveBeenCalledWith({
      leadId: 'ld_1',
      patch: { sourceLabel: 'Referral from Dave' },
    })
    expect(editButton(table).textContent).toBe('Referral from Dave')
    expect(await screen.findByText('Source updated.')).toBeTruthy()
  })

  it('goes back to the delivered source when cleared', async () => {
    const user = userEvent.setup()
    const updateLead = vi.fn(async () => {})
    const table = renderList({ updateLead }, { ...LEAD, sourceLabel: 'Trade show' } as Lead)

    expect(editButton(table).textContent).toBe('Trade show')
    await user.click(editButton(table))
    const input = within(table).getByLabelText('Source for Dean Sample') as HTMLInputElement
    expect(input.value).toBe('Trade show')
    await user.clear(input)
    await user.click(within(table).getByRole('button', { name: 'Save source for Dean Sample' }))

    expect(updateLead).toHaveBeenCalledWith({ leadId: 'ld_1', patch: { sourceLabel: null } })
    expect(editButton(table).textContent).toBe('Facebook · EPIC DM')
  })

  it('saves nothing when unchanged, or on Escape', async () => {
    const user = userEvent.setup()
    const updateLead = vi.fn(async () => {})
    const table = renderList({ updateLead })

    await user.click(editButton(table))
    await user.type(within(table).getByLabelText('Source for Dean Sample'), 'Typed{Escape}')
    expect(within(table).queryByLabelText('Source for Dean Sample')).toBeNull()

    await user.click(editButton(table))
    await user.keyboard('{Enter}')
    expect(updateLead).not.toHaveBeenCalled()
  })

  it('puts the previous source back when the save fails', async () => {
    const user = userEvent.setup()
    const table = renderList({ updateLead: vi.fn(async () => Promise.reject(new Error('nope'))) })

    await user.click(editButton(table))
    await user.type(within(table).getByLabelText('Source for Dean Sample'), 'Walk-in{Enter}')

    await waitFor(() => expect(editButton(table).textContent).toBe('Facebook · EPIC DM'))
  })
})
