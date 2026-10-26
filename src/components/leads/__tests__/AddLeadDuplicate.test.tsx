import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, within, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AddLeadDialog } from '../AddLeadDialog'
import { LeadsStoreProvider, type LeadsPersistence } from '../LeadsStore'
import { ToastProvider } from '@/components/ui/Toast'

/**
 * Add lead with an email that already has a lead: staff are warned first, and
 * only "Add anyway" sends it. Synthetic data only.
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

const EXISTING = { id: '00000000-0000-4000-8000-000000000001', name: 'Earlier Person', stage: 'prospect' as const }

describe('AddLeadDialog — an email that already has a lead', () => {
  it('adds straight away when the email is new', async () => {
    const user = userEvent.setup()
    const createLead = vi.fn(async () => {})
    const findLeadByEmail = vi.fn(async () => null)
    const dialog = renderDialog({ createLead, findLeadByEmail })

    await fillAndSubmit(user, dialog)

    await waitFor(() => expect(createLead).toHaveBeenCalledTimes(1))
    expect(findLeadByEmail).toHaveBeenCalledWith('test.person@example.test')
    expect(screen.queryByText('A lead with this email already exists.')).toBeNull()
  })

  it('warns and sends nothing until Add anyway', async () => {
    const user = userEvent.setup()
    const createLead = vi.fn(async () => {})
    const dialog = renderDialog({ createLead, findLeadByEmail: async () => EXISTING })

    await fillAndSubmit(user, dialog)

    expect(await within(dialog).findByText('A lead with this email already exists.')).toBeTruthy()
    expect(within(dialog).getByText(/Earlier Person \(Prospect\)/)).toBeTruthy()
    expect(within(dialog).getByRole('link', { name: 'Open their lead' }).getAttribute('href')).toBe(
      `/leads/${EXISTING.id}`,
    )
    expect(createLead).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: 'Add anyway' }))
    await waitFor(() => expect(createLead).toHaveBeenCalledTimes(1))
  })

  it('Cancel on the warning goes back to the form with nothing sent', async () => {
    const user = userEvent.setup()
    const createLead = vi.fn(async () => {})
    const dialog = renderDialog({ createLead, findLeadByEmail: async () => EXISTING })

    await fillAndSubmit(user, dialog)
    await within(dialog).findByText('A lead with this email already exists.')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(within(dialog).queryByText('A lead with this email already exists.')).toBeNull()
    expect((within(dialog).getByLabelText('Name') as HTMLInputElement).value).toBe('Test Person')
    expect(createLead).not.toHaveBeenCalled()
  })

  it('does not add unchecked when the check fails', async () => {
    const user = userEvent.setup()
    const createLead = vi.fn(async () => {})
    const findLeadByEmail = vi.fn(async () => {
      throw new Error('offline')
    })
    const dialog = renderDialog({ createLead, findLeadByEmail })

    await fillAndSubmit(user, dialog)

    expect(await within(dialog).findByText(/Could not check whether this email/)).toBeTruthy()
    expect(createLead).not.toHaveBeenCalled()
  })
})
