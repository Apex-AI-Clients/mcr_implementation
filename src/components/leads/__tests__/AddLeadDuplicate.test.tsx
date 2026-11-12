import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, within, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AddLeadDialog } from '../AddLeadDialog'
import { LeadsStoreProvider, type LeadsPersistence } from '../LeadsStore'
import { ToastProvider } from '@/components/ui/Toast'

/**
 * Add lead with an email that already has a lead: added straight away, no
 * warning and no lookup first. The server makes it a new enquiry on that
 * lead. Synthetic data only.
 */

const router = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }

vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/leads',
}))

afterEach(() => cleanup())

function renderDialog(persistence: LeadsPersistence) {
  render(
    <ToastProvider>
      <LeadsStoreProvider author="Tester" persistence={persistence}>
        <AddLeadDialog open onClose={() => {}} />
      </LeadsStoreProvider>
    </ToastProvider>,
  )
  return screen.getByRole('dialog')
}

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement) {
  await user.type(within(dialog).getByLabelText('Name'), 'Test Person')
  await user.type(within(dialog).getByLabelText('Email'), 'test.person@example.test')
  await user.type(within(dialog).getByLabelText('Phone'), '0400 000 001')
  await user.selectOptions(within(dialog).getByLabelText('Debt'), '7')
  await user.click(within(dialog).getByLabelText('State'))
  await user.click(within(dialog).getByRole('checkbox', { name: 'NSW' }))
  await user.click(within(dialog).getByRole('button', { name: 'Add lead' }))
}

describe('AddLeadDialog — an email that already has a lead', () => {
  it('adds straight away, without looking the email up or warning', async () => {
    const user = userEvent.setup()
    const createLead = vi.fn(async () => {})
    const findLeadByEmail = vi.fn(async () => ({
      id: '00000000-0000-4000-8000-000000000001',
      name: 'Earlier Person',
      stage: 'prospect' as const,
    }))
    const dialog = renderDialog({ createLead, findLeadByEmail })

    await fillAndSubmit(user, dialog)

    await waitFor(() => expect(createLead).toHaveBeenCalledTimes(1))
    expect(findLeadByEmail).not.toHaveBeenCalled()
    expect(screen.queryByText('A lead with this email already exists.')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Add anyway' })).toBeNull()
  })
})
