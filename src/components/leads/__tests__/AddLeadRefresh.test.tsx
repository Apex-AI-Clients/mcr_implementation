import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, waitFor, within, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AddLeadDialog } from '../AddLeadDialog'
import { LeadsStoreProvider, type LeadsPersistence } from '../LeadsStore'
import { ToastProvider } from '@/components/ui/Toast'

/**
 * Adding a lead by hand, and when the list is re-read.
 *
 * The list shows what the server sent, so the new lead appears only after a
 * re-read that can find it. The re-read used to be fired at the same moment as
 * the insert and usually won the race, so the lead showed up only after a
 * manual reload. Synthetic data only.
 */

const router = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }

vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/leads',
}))

beforeEach(() => {
  router.push.mockClear()
  router.refresh.mockClear()
})

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

describe('AddLeadDialog — re-reading the list', () => {
  it('waits for the lead to be saved before refreshing', async () => {
    const user = userEvent.setup()
    let finishSave: () => void = () => {}
    const createLead = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishSave = resolve
        }),
    )
    const dialog = renderDialog({ createLead })

    await fillAndSubmit(user, dialog)

    // Sent, but not saved yet: a refresh now would read a list without it.
    expect(createLead).toHaveBeenCalledTimes(1)
    expect(router.push).toHaveBeenCalledWith('/leads')
    expect(router.refresh).not.toHaveBeenCalled()

    finishSave()

    await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(1))
  })

  it('does not refresh when the save fails', async () => {
    const user = userEvent.setup()
    const createLead = vi.fn(async () => {
      throw new Error('insert failed')
    })
    const dialog = renderDialog({ createLead })

    await fillAndSubmit(user, dialog)

    await waitFor(() => expect(screen.getByText(/could not be saved/)).toBeTruthy())
    expect(router.refresh).not.toHaveBeenCalled()
  })
})
