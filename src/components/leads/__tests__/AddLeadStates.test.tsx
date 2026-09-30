import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, within, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AddLeadDialog } from '../AddLeadDialog'
import { LeadsStoreProvider, type LeadsPersistence } from '../LeadsStore'
import { ToastProvider } from '@/components/ui/Toast'
import type { Lead } from '@/types/leads'

/**
 * Choosing states when a lead is added by hand: a dropdown where one or
 * several can be ticked, because a business can trade in more than one state.
 * Synthetic data only.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/leads',
}))

afterEach(() => cleanup())

type User = ReturnType<typeof userEvent.setup>

function renderDialog(onClose = vi.fn()) {
  const createLead = vi.fn<NonNullable<LeadsPersistence['createLead']>>(async () => {})
  render(
    <ToastProvider>
      <LeadsStoreProvider author="Tester" persistence={{ createLead }}>
        <AddLeadDialog open onClose={onClose} />
      </LeadsStoreProvider>
    </ToastProvider>,
  )
  return { dialog: screen.getByRole('dialog'), createLead, onClose }
}

/** The closed dropdown: a button labelled "State". */
function stateButton(dialog: HTMLElement) {
  // By role: once open, the list is labelled "State" too.
  return within(dialog).getByRole('button', { name: 'State' }) as HTMLButtonElement
}

function option(dialog: HTMLElement, name: string) {
  return within(dialog).getByRole('checkbox', { name }) as HTMLInputElement
}

async function tick(user: User, dialog: HTMLElement, ...states: string[]) {
  if (stateButton(dialog).getAttribute('aria-expanded') !== 'true') {
    await user.click(stateButton(dialog))
  }
  for (const state of states) await user.click(option(dialog, state))
}

async function fillTheRest(user: User, dialog: HTMLElement) {
  await user.type(within(dialog).getByLabelText('Name'), 'Test Person')
  await user.type(within(dialog).getByLabelText('Email'), 'test.person@example.test')
  await user.type(within(dialog).getByLabelText('Phone'), '0400 000 001')
  await user.selectOptions(within(dialog).getByLabelText('Debt'), '7')
}

async function savedLead(createLead: ReturnType<typeof renderDialog>['createLead']): Promise<Lead> {
  await waitFor(() => expect(createLead).toHaveBeenCalledTimes(1))
  return createLead.mock.calls[0][0].lead
}

describe('AddLeadDialog — the State dropdown', () => {
  it('is closed to start with, showing "Select"', () => {
    const { dialog } = renderDialog()
    expect(stateButton(dialog).textContent).toBe('Select')
    expect(stateButton(dialog).getAttribute('aria-expanded')).toBe('false')
    expect(within(dialog).queryByRole('checkbox')).toBeNull()
  })

  it('opens to every state as a tick box, none chosen', async () => {
    const user = userEvent.setup()
    const { dialog } = renderDialog()
    await user.click(stateButton(dialog))

    const list = within(dialog).getByRole('group', { name: 'State' })
    const boxes = within(list).getAllByRole('checkbox') as HTMLInputElement[]
    expect(boxes.map((box) => box.closest('label')?.textContent)).toEqual([
      'NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT',
    ])
    expect(boxes.every((box) => !box.checked)).toBe(true)
  })

  it('stays open while several are ticked, and shows them on the button in a fixed order', async () => {
    const user = userEvent.setup()
    const { dialog } = renderDialog()
    // Ticked out of order on purpose.
    await tick(user, dialog, 'VIC', 'NSW', 'TAS')

    expect(stateButton(dialog).getAttribute('aria-expanded')).toBe('true')
    expect(stateButton(dialog).textContent).toBe('NSW, VIC, TAS')
  })

  it('closes on Escape without closing the dialog, keeping what was ticked', async () => {
    const user = userEvent.setup()
    const { dialog, onClose } = renderDialog()
    await tick(user, dialog, 'NSW')

    await user.keyboard('{Escape}')

    expect(within(dialog).queryByRole('checkbox')).toBeNull()
    expect(stateButton(dialog).textContent).toBe('NSW')
    expect(onClose).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(stateButton(dialog))

    // With the dropdown shut, Escape is the dialog's again.
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes on a click elsewhere in the form', async () => {
    const user = userEvent.setup()
    const { dialog } = renderDialog()
    await tick(user, dialog, 'QLD')

    await user.click(within(dialog).getByLabelText('Name'))

    expect(within(dialog).queryByRole('checkbox')).toBeNull()
    expect(stateButton(dialog).textContent).toBe('QLD')
  })

  it('can be worked from the keyboard', async () => {
    const user = userEvent.setup()
    const { dialog } = renderDialog()
    stateButton(dialog).focus()

    await user.keyboard('{Enter}') // open
    await user.keyboard('{Tab} ') // first option: NSW
    await user.keyboard('{Tab} ') // second: VIC

    expect(stateButton(dialog).textContent).toBe('NSW, VIC')
  })
})

describe('AddLeadDialog — what is saved', () => {
  it('saves one state as the state', async () => {
    const user = userEvent.setup()
    const { dialog, createLead } = renderDialog()
    await fillTheRest(user, dialog)
    await tick(user, dialog, 'QLD')
    await user.click(within(dialog).getByRole('button', { name: 'Add lead' }))

    expect(await savedLead(createLead)).toMatchObject({
      state: 'QLD',
      metaStateRaw: null,
      metaStateOptions: null,
    })
  })

  it('saves several states as a list, in a fixed order', async () => {
    const user = userEvent.setup()
    const { dialog, createLead } = renderDialog()
    await fillTheRest(user, dialog)
    await tick(user, dialog, 'VIC', 'NSW', 'TAS')
    await user.click(within(dialog).getByRole('button', { name: 'Add lead' }))

    expect(await savedLead(createLead)).toMatchObject({
      state: null,
      metaStateRaw: 'NSW, VIC, TAS',
      metaStateOptions: ['NSW', 'VIC', 'TAS'],
    })
  })

  it('lets a state be unticked again', async () => {
    const user = userEvent.setup()
    const { dialog, createLead } = renderDialog()
    await fillTheRest(user, dialog)
    await tick(user, dialog, 'NSW', 'VIC', 'NSW')
    expect(option(dialog, 'NSW').checked).toBe(false)
    await user.click(within(dialog).getByRole('button', { name: 'Add lead' }))

    expect((await savedLead(createLead)).state).toBe('VIC')
  })

  it('will not save with no state ticked, and clears the error once one is', async () => {
    const user = userEvent.setup()
    const { dialog, createLead } = renderDialog()
    await fillTheRest(user, dialog)
    await user.click(within(dialog).getByRole('button', { name: 'Add lead' }))

    expect(within(dialog).getByText('Choose a state.')).toBeTruthy()
    expect(createLead).not.toHaveBeenCalled()

    await tick(user, dialog, 'SA')
    expect(within(dialog).queryByText('Choose a state.')).toBeNull()
  })
})
