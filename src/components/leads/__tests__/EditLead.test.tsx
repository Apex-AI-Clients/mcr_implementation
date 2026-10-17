import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, within, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LeadRecordClient } from '../LeadRecordClient'
import { LeadsStoreProvider, type LeadsPersistence } from '../LeadsStore'
import { ToastProvider } from '@/components/ui/Toast'
import type { Lead } from '@/types/leads'

/**
 * Edit lead on the record: the button beside Delete, a form prefilled from the
 * lead, and a patch carrying only what changed. Synthetic data only.
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
  message: 'Original message',
  preferredCallTime: null,
  stage: 'lead',
  source: 'facebook',
  sourceLabel: null,
  entityTypeLabel: null,
  company: null,
  nextStep: null,
  stageSince: '2026-08-20T00:00:00.000Z',
  lastActionAt: '2026-09-10T00:00:00.000Z',
  lastEnquiryAt: '2026-09-10T04:05:00.000Z',
  enquiryCount: 1,
  latestEnquirySource: null,
  reenquiredAfterCloseAt: null,
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

function renderRecord(lead: Lead = LEAD) {
  const updateLead = vi.fn<NonNullable<LeadsPersistence['updateLead']>>(async () => {})
  render(
    <ToastProvider>
      <LeadsStoreProvider author="Tester" persistence={{ updateLead }}>
        <LeadRecordClient
          leadId={lead.id}
          initialLead={lead}
          initialActivities={[]}
          enquiries={[]}
          convertedClient={null}
        />
      </LeadsStoreProvider>
    </ToastProvider>,
  )
  return { updateLead }
}

async function openEdit() {
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Edit' }))
  return { user, dialog: await screen.findByRole('dialog') }
}

describe('Edit lead', () => {
  it('sits to the left of Delete', () => {
    renderRecord()
    const edit = screen.getByRole('button', { name: 'Edit' })
    const del = screen.getByRole('button', { name: 'Delete' })
    expect(edit.compareDocumentPosition(del) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('opens prefilled from the lead', async () => {
    renderRecord()
    const { dialog } = await openEdit()
    expect((within(dialog).getByLabelText('Name') as HTMLInputElement).value).toBe('Test Person')
    expect((within(dialog).getByLabelText('Email') as HTMLInputElement).value).toBe(
      'test@example.test',
    )
    expect((within(dialog).getByLabelText('Source') as HTMLSelectElement).value).toBe('facebook')
    expect((within(dialog).getByLabelText('Their message') as HTMLTextAreaElement).value).toBe(
      'Original message',
    )
  })

  it('sends only the fields that changed', async () => {
    const { updateLead } = renderRecord()
    const { user, dialog } = await openEdit()
    const name = within(dialog).getByLabelText('Name')
    await user.clear(name)
    await user.type(name, 'Renamed Person')
    await user.type(within(dialog).getByLabelText('Preferred call time'), 'Mornings')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    expect(updateLead).toHaveBeenCalledWith({
      leadId: 'ld_1',
      patch: { name: 'Renamed Person', preferredCallTime: 'Mornings' },
    })
    expect(screen.getByRole('heading', { name: 'Renamed Person' })).toBeTruthy()
  })

  it('saves a typed source as the source label, leaving the delivered source', async () => {
    const { updateLead } = renderRecord()
    const { user, dialog } = await openEdit()
    await user.click(within(dialog).getByRole('checkbox', { name: 'Type my own source' }))
    await user.type(within(dialog).getByLabelText('Source'), 'Referral — Dave')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    expect(updateLead).toHaveBeenCalledWith({
      leadId: 'ld_1',
      patch: { sourceLabel: 'Referral — Dave' },
    })
  })

  it('asks for the typed source when the box is ticked and left blank', async () => {
    const { updateLead } = renderRecord()
    const { user, dialog } = await openEdit()
    await user.click(within(dialog).getByRole('checkbox', { name: 'Type my own source' }))
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    expect(within(dialog).getByText('Type the source, or untick to pick one.')).toBeTruthy()
    expect(updateLead).not.toHaveBeenCalled()
  })

  it('opens a typed source ticked, and picking from the list clears it', async () => {
    const { updateLead } = renderRecord({ ...LEAD, sourceLabel: 'Trade show' })
    const { user, dialog } = await openEdit()
    const box = within(dialog).getByRole('checkbox', { name: 'Type my own source' })
    expect((box as HTMLInputElement).checked).toBe(true)
    expect((within(dialog).getByLabelText('Source') as HTMLInputElement).value).toBe('Trade show')
    await user.click(box)
    await user.selectOptions(within(dialog).getByLabelText('Source'), 'website')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    expect(updateLead).toHaveBeenCalledWith({
      leadId: 'ld_1',
      patch: { source: 'website', sourceLabel: null },
    })
  })

  it('saves a typed debt as an exact figure', async () => {
    const { updateLead } = renderRecord()
    const { user, dialog } = await openEdit()
    await user.click(within(dialog).getByRole('checkbox', { name: 'Type my own debt' }))
    await user.type(within(dialog).getByLabelText('Debt'), '$187k')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    expect(updateLead).toHaveBeenCalledWith({
      leadId: 'ld_1',
      patch: { debtMin: 187_000, debtMax: 187_000 },
    })
  })

  it('refuses a typed debt it cannot read', async () => {
    const { updateLead } = renderRecord()
    const { user, dialog } = await openEdit()
    await user.click(within(dialog).getByRole('checkbox', { name: 'Type my own debt' }))
    await user.type(within(dialog).getByLabelText('Debt'), 'lots')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    expect(within(dialog).getByText('Enter an amount, e.g. 120000 or $120k.')).toBeTruthy()
    expect(updateLead).not.toHaveBeenCalled()
  })

  it('opens an exact debt ticked, with the figure filled in', async () => {
    renderRecord({ ...LEAD, debtMin: 210_000, debtMax: 210_000 })
    const { dialog } = await openEdit()
    const box = within(dialog).getByRole('checkbox', { name: 'Type my own debt' })
    expect((box as HTMLInputElement).checked).toBe(true)
    expect((within(dialog).getByLabelText('Debt') as HTMLInputElement).value).toBe('210000')
  })

  it('saves a typed state as given, with no state ticked', async () => {
    const { updateLead } = renderRecord()
    const { user, dialog } = await openEdit()
    await user.click(within(dialog).getByRole('checkbox', { name: 'Type my own state' }))
    await user.type(within(dialog).getByLabelText('State'), 'Australia wide')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    expect(updateLead).toHaveBeenCalledWith({
      leadId: 'ld_1',
      patch: { state: null, metaStateOptions: null, metaStateRaw: 'Australia wide' },
    })
  })

  it('saves a typed business type and clears company or trust', async () => {
    const { updateLead } = renderRecord()
    const { user, dialog } = await openEdit()
    await user.click(within(dialog).getByRole('checkbox', { name: 'Type my own business type' }))
    await user.type(within(dialog).getByLabelText('Business type'), 'Sole trader')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    expect(updateLead).toHaveBeenCalledWith({
      leadId: 'ld_1',
      patch: { entityTypeLabel: 'Sole trader', entityType: null },
    })
    // The record shows what was typed.
    expect(screen.getByText('Sole trader')).toBeTruthy()
  })

  it('refuses an invalid email', async () => {
    const { updateLead } = renderRecord()
    const { user, dialog } = await openEdit()
    const email = within(dialog).getByLabelText('Email')
    await user.clear(email)
    await user.type(email, 'not-an-email')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    expect(within(dialog).getByText('That email address does not look right.')).toBeTruthy()
    expect(updateLead).not.toHaveBeenCalled()
  })

  it('saves nothing when nothing changed', async () => {
    const { updateLead } = renderRecord()
    const { user, dialog } = await openEdit()
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    expect(updateLead).not.toHaveBeenCalled()
  })
})
