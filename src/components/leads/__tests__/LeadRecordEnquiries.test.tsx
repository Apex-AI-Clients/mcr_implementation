import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, within, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LeadRecordClient } from '../LeadRecordClient'
import { LeadsStoreProvider, type LeadsPersistence } from '../LeadsStore'
import { ToastProvider } from '@/components/ui/Toast'
import type { Lead, LeadSubmission } from '@/types/leads'

/**
 * The record's side of repeat enquiries: the Enquiries list, and the
 * "enquired again" notice with its Dismiss. Synthetic data only.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/leads/ld_1',
}))

afterEach(() => cleanup())

const LEAD: Lead = {
  id: 'ld_1',
  name: 'Test Person',
  email: 'test@example.test',
  phone: '0400000001',
  debtMin: 250_000,
  debtMax: 499_999,
  state: 'NSW',
  metaStateRaw: null,
  metaStateOptions: null,
  entityType: 'company',
  message: null,
  preferredCallTime: null,
  stage: 'non_proceeding',
  source: 'facebook',
  sourceLabel: null,
  company: null,
  nextStep: null,
  stageSince: '2026-08-20T00:00:00.000Z',
  lastActionAt: '2026-09-10T00:00:00.000Z',
  lastEnquiryAt: '2026-09-10T04:05:00.000Z',
  enquiryCount: 2,
  latestEnquirySource: null,
  reenquiredAfterCloseAt: '2026-09-10T04:05:00.000Z',
  reenquiryDismissedAt: null,
  reenquiryDismissedBy: null,
  convertedClientId: null,
  metaFormId: null,
  metaAdId: null,
  metaAdgroupId: null,
  metaPageId: null,
  metaCampaignId: null,
  metaCampaignName: null,
  metaAdName: null,
  metaAccountId: null,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-09-10T00:00:00.000Z',
}

function enquiry(overrides: Partial<LeadSubmission>): LeadSubmission {
  return {
    id: 'sub',
    leadId: 'ld_1',
    receivedAt: '2026-08-01T00:00:00.000Z',
    afterClose: false,
    name: 'Test Person',
    email: 'test@example.test',
    phone: '0400000001',
    debtMin: 100_000,
    debtMax: 124_999,
    state: 'NSW',
    metaStateRaw: null,
    metaStateOptions: null,
    entityType: 'company',
    message: null,
    preferredCallTime: null,
    source: 'facebook',
    metaFormId: 'form-1',
    metaAdId: null,
    metaCampaignName: null,
    metaAdName: null,
    ...overrides,
  }
}

// Newest first, as getSubmissionsForLead returns them.
const ENQUIRIES = [
  enquiry({
    id: 'sub-2',
    receivedAt: '2026-09-10T04:05:00.000Z',
    afterClose: true,
    source: 'website',
    metaFormId: null,
    debtMin: 250_000,
    debtMax: 499_999,
    entityType: null,
  }),
  enquiry({ id: 'sub-1' }),
]

function renderRecord(lead: Lead = LEAD, persistence: LeadsPersistence = {}) {
  return render(
    <ToastProvider>
      <LeadsStoreProvider author="Tester" persistence={persistence}>
        <LeadRecordClient
          leadId={lead.id}
          initialLead={lead}
          initialActivities={[]}
          enquiries={ENQUIRIES}
          convertedClient={null}
        />
      </LeadsStoreProvider>
    </ToastProvider>,
  )
}

function enquiriesSection() {
  return screen.getByRole('region', { name: /Enquiries/ })
}

describe('Enquiries on the lead record', () => {
  it('lists every enquiry, newest first, with when and where it came from', () => {
    renderRecord()
    const items = within(enquiriesSection()).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(within(items[0]).getByText('10 Sept 2026, 2:05 pm')).toBeTruthy()
    expect(within(items[0]).getByText('Website')).toBeTruthy()
    expect(within(items[0]).getByText('Latest')).toBeTruthy()
    expect(within(items[0]).getByText('After conversion or closure')).toBeTruthy()
    expect(within(items[1]).getByText('Facebook')).toBeTruthy()
    expect(within(items[1]).getByText('Form form-1')).toBeTruthy()
  })

  it('opens the newest and collapses the rest', () => {
    renderRecord()
    const details = enquiriesSection().querySelectorAll('details')
    expect(details[0].open).toBe(true)
    expect(details[1].open).toBe(false)
  })

  it('highlights what changed since the enquiry before, for sight and for screen readers', () => {
    renderRecord()
    const newest = within(enquiriesSection()).getAllByRole('listitem')[0]
    // Debt went from $100k–$125k to $250k–$500k.
    expect(within(newest).getAllByText('(changed from the enquiry before)', { exact: false })).toHaveLength(1)
    // Left blank this time: shown as not given, not as a change.
    const businessType = within(newest).getByText('Business type')
    expect(businessType.nextElementSibling?.textContent).toBe('Not given')
  })

  it('says so in the header when there has been more than one enquiry', () => {
    renderRecord()
    expect(screen.getByText(/2 enquiries, latest 10 Sept 2026/)).toBeTruthy()
  })
})

describe('"Enquired again" notice', () => {
  it('shows on a closed lead that has enquired again', () => {
    renderRecord()
    const notice = screen.getByText('New enquiry after closure').closest('[role="status"]') as HTMLElement
    expect(notice).toBeTruthy()
    expect(within(notice).getByText(/enquired again on 10 Sept 2026/)).toBeTruthy()
  })

  it('is not shown when there is nothing new', () => {
    renderRecord({ ...LEAD, reenquiredAfterCloseAt: null })
    expect(screen.queryByText(/New enquiry after/)).toBeNull()
  })

  it('dismisses without logging an action, and records who did it', async () => {
    const user = userEvent.setup()
    const dismissReenquiry = vi.fn(async () => {})
    const logActivity = vi.fn(async () => {})
    renderRecord(LEAD, { dismissReenquiry, logActivity })

    await user.click(screen.getByRole('button', { name: 'Dismiss' }))

    expect(screen.queryByText('New enquiry after closure')).toBeNull()
    expect(dismissReenquiry).toHaveBeenCalledWith({ leadId: 'ld_1' })
    // Not a logged action: nothing written to the timeline.
    expect(logActivity).not.toHaveBeenCalled()
    expect(within(enquiriesSection()).getByText(/marker dismissed by Tester/)).toBeTruthy()
  })

  it('puts the notice back if the dismissal does not save', async () => {
    const user = userEvent.setup()
    const dismissReenquiry = vi.fn(async () => {
      throw new Error('boom')
    })
    renderRecord(LEAD, { dismissReenquiry })

    await user.click(screen.getByRole('button', { name: 'Dismiss' }))
    await waitFor(() => expect(screen.getByText('New enquiry after closure')).toBeTruthy())
    expect(screen.getByText("That didn't save. The marker has been put back.")).toBeTruthy()
  })
})
