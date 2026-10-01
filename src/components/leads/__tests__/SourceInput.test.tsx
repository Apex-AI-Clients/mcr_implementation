import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, within, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LeadsPageClient } from '../LeadsPageClient'
import { LeadsStoreProvider, type LeadsPersistence } from '../LeadsStore'
import { ToastProvider } from '@/components/ui/Toast'
import { EMPTY_FILTERS } from '@/lib/leads/filter'
import type { Lead } from '@/types/leads'

/**
 * Correcting a lead's source in the table, like the debt. Driven through the
 * real list so the store and the save are exercised. Synthetic data only.
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

describe('SourceInput', () => {
  it('shows the source with its partner, and edits it in place', async () => {
    const user = userEvent.setup()
    const updateLead = vi.fn(async () => {})
    const table = renderList({ updateLead })

    const button = within(table).getByRole('button', { name: 'Edit source for Dean Sample' })
    expect(button.textContent).toBe('Facebook · EPIC DM')

    await user.click(button)
    const select = within(table).getByLabelText('Source for Dean Sample') as HTMLSelectElement
    // Google Form has no live form, so it is not offered.
    expect([...select.options].map((option) => option.textContent)).toEqual([
      'Facebook',
      'Website',
      'Added manually',
    ])
    await user.selectOptions(select, 'website')

    expect(updateLead).toHaveBeenCalledWith({ leadId: 'ld_1', patch: { source: 'website' } })
    // Back to the label; the partner goes with the Facebook source.
    expect(
      within(table).getByRole('button', { name: 'Edit source for Dean Sample' }).textContent,
    ).toBe('Website')
    expect(await screen.findByText('Source updated.')).toBeTruthy()
  })

  it('saves nothing when the same source is chosen, or on Escape', async () => {
    const user = userEvent.setup()
    const updateLead = vi.fn(async () => {})
    const table = renderList({ updateLead })

    await user.click(within(table).getByRole('button', { name: 'Edit source for Dean Sample' }))
    await user.keyboard('{Escape}')
    expect(within(table).queryByLabelText('Source for Dean Sample')).toBeNull()

    await user.click(within(table).getByRole('button', { name: 'Edit source for Dean Sample' }))
    await user.selectOptions(within(table).getByLabelText('Source for Dean Sample'), 'facebook')
    expect(updateLead).not.toHaveBeenCalled()
  })

  it('still offers Google Form to a lead that already has it', async () => {
    const user = userEvent.setup()
    const table = renderList({ updateLead: vi.fn(async () => {}) }, {
      ...LEAD,
      source: 'google_form',
    } as Lead)

    await user.click(within(table).getByRole('button', { name: 'Edit source for Dean Sample' }))
    const select = within(table).getByLabelText('Source for Dean Sample') as HTMLSelectElement
    expect(select.value).toBe('google_form')
    expect([...select.options].map((option) => option.value)).toContain('google_form')
  })

  it('puts the previous source back when the save fails', async () => {
    const user = userEvent.setup()
    const table = renderList({ updateLead: vi.fn(async () => Promise.reject(new Error('nope'))) })

    await user.click(within(table).getByRole('button', { name: 'Edit source for Dean Sample' }))
    await user.selectOptions(within(table).getByLabelText('Source for Dean Sample'), 'manual')

    await waitFor(() =>
      expect(
        within(table).getByRole('button', { name: 'Edit source for Dean Sample' }).textContent,
      ).toBe('Facebook · EPIC DM'),
    )
  })
})
