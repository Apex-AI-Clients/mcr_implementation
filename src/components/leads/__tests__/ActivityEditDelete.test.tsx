import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, within, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LeadActivityTimeline } from '../LeadActivityTimeline'
import { LeadsStoreProvider, type LeadsPersistence } from '../LeadsStore'
import { ToastProvider } from '@/components/ui/Toast'
import type { Lead, LeadActivity } from '@/types/leads'

/**
 * Correcting and removing timeline entries.
 *
 * The rules worth pinning: a stage change is never editable, nothing is
 * removed without the dialog, a failed write leaves the entry exactly as it
 * was, and none of it resets the follow-up clock — editing the wording of a
 * note is not evidence anybody contacted the lead.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/leads/ld_1',
}))

afterEach(cleanup)

const LEAD: Lead = {
  id: 'ld_1',
  name: 'Dean Whitlock',
  email: 'dean@whitlockcivil.com.au',
  phone: '0407552118',
  debtMin: 150_000,
  debtMax: null,
  state: 'QLD',
  entityType: 'company',
  message: null,
  preferredCallTime: null,
  stage: 'prospect',
  source: 'website',
  company: null,
  nextStep: 'Book the director meeting.',
  stageSince: '2026-08-20T00:00:00.000Z',
  lastActionAt: '2026-08-30T00:00:00.000Z',
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
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-30T00:00:00.000Z',
}

function act(overrides: Partial<LeadActivity> = {}): LeadActivity {
  return {
    id: 'ac_1',
    leadId: 'ld_1',
    type: 'note',
    body: 'Spoke about the BAS arrears.',
    author: 'Gabby',
    createdAt: '2026-08-10T00:00:00.000Z',
    ...overrides,
  }
}

const NOTE = act()
const STAGE = act({
  id: 'ac_stage',
  type: 'stage_change',
  body: 'Stage changed from Lead to Prospect.',
  createdAt: '2026-08-11T00:00:00.000Z',
})

function renderTimeline(
  activities: LeadActivity[] = [NOTE],
  persistence?: LeadsPersistence,
  editable = true,
) {
  return render(
    <ToastProvider>
      <LeadsStoreProvider
        author="Gabby"
        initialLeads={[LEAD]}
        initialActivities={activities}
        persistence={persistence}
      >
        <LeadActivityTimeline activities={activities} editable={editable} />
      </LeadsStoreProvider>
    </ToastProvider>,
  )
}

const EDIT_NOTE = /^Edit note/
const DELETE_NOTE = /^Delete note/

describe('editing an entry', () => {
  it('opens an inline editor with the current wording', async () => {
    const user = userEvent.setup()
    renderTimeline()

    await user.click(screen.getByRole('button', { name: EDIT_NOTE }))
    const box = screen.getByRole('textbox') as HTMLTextAreaElement
    expect(box.value).toBe('Spoke about the BAS arrears.')
  })

  it('saves the correction', async () => {
    const user = userEvent.setup()
    const editActivity = vi.fn(async () => {})
    renderTimeline([NOTE], { editActivity })

    await user.click(screen.getByRole('button', { name: EDIT_NOTE }))
    const box = screen.getByRole('textbox')
    await user.clear(box)
    await user.type(box, 'Spoke about the BAS and GST arrears.')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(editActivity).toHaveBeenCalledWith({
        leadId: 'ld_1',
        activityId: 'ac_1',
        body: 'Spoke about the BAS and GST arrears.',
      }),
    )
  })

  it('will not save an empty note or an unchanged one', async () => {
    const user = userEvent.setup()
    const editActivity = vi.fn(async () => {})
    renderTimeline([NOTE], { editActivity })

    await user.click(screen.getByRole('button', { name: EDIT_NOTE }))
    // Unchanged.
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true)

    await user.clear(screen.getByRole('textbox'))
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true)
    expect(editActivity).not.toHaveBeenCalled()
  })

  it('abandons the edit on Cancel', async () => {
    const user = userEvent.setup()
    const editActivity = vi.fn(async () => {})
    renderTimeline([NOTE], { editActivity })

    await user.click(screen.getByRole('button', { name: EDIT_NOTE }))
    await user.type(screen.getByRole('textbox'), ' extra')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(editActivity).not.toHaveBeenCalled()
    expect(screen.getByText('Spoke about the BAS arrears.')).toBeTruthy()
  })

  it('puts the original wording back when the save fails', async () => {
    // The screen must never keep showing an edit the database rejected.
    const user = userEvent.setup()
    const editActivity = vi.fn(async () => {
      throw new Error('nope')
    })
    renderTimeline([NOTE], { editActivity })

    await user.click(screen.getByRole('button', { name: EDIT_NOTE }))
    await user.type(screen.getByRole('textbox'), ' and GST')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(editActivity).toHaveBeenCalled())
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByText('Spoke about the BAS arrears.')).toBeTruthy()
  })
})

describe('deleting an entry', () => {
  it('asks first', async () => {
    const user = userEvent.setup()
    const deleteActivity = vi.fn(async () => {})
    renderTimeline([NOTE], { deleteActivity })

    await user.click(screen.getByRole('button', { name: DELETE_NOTE }))

    const dialog = await screen.findByRole('dialog')
    // Shows what is about to go, not just "Are you sure?".
    expect(within(dialog).getByText('Spoke about the BAS arrears.')).toBeTruthy()
    expect(deleteActivity).not.toHaveBeenCalled()
  })

  it('deletes on confirmation', async () => {
    const user = userEvent.setup()
    const deleteActivity = vi.fn(async () => {})
    renderTimeline([NOTE], { deleteActivity })

    await user.click(screen.getByRole('button', { name: DELETE_NOTE }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() =>
      expect(deleteActivity).toHaveBeenCalledWith({ leadId: 'ld_1', activityId: 'ac_1' }),
    )
  })

  it('keeps the entry and says why when the delete fails', async () => {
    const user = userEvent.setup()
    const deleteActivity = vi.fn(async () => {
      throw new Error('Network is down')
    })
    renderTimeline([NOTE], { deleteActivity })

    await user.click(screen.getByRole('button', { name: DELETE_NOTE }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    const alert = await within(dialog).findByRole('alert')
    expect(alert.textContent).toContain('Network is down')
    // Still on the timeline. Scoped to the list, because the open dialog is
    // also showing the same text in its preview.
    const list = screen.getByRole('list')
    expect(within(list).getByText('Spoke about the BAS arrears.')).toBeTruthy()
  })

  it('warns that a next step falls back to the previous one', async () => {
    const user = userEvent.setup()
    const step = act({ id: 'ac_step', type: 'next_step', body: 'Book the director meeting.' })
    renderTimeline([step], { deleteActivity: async () => {} })

    await user.click(screen.getByRole('button', { name: /^Delete next step/ }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/falls back to the previous one/)).toBeTruthy()
  })
})

describe('what cannot be touched', () => {
  it('offers no controls on a stage change', async () => {
    // Editing one would leave the timeline disagreeing with the stage it
    // produced. A mistaken stage change is fixed by changing the stage again.
    renderTimeline([STAGE])
    expect(screen.queryByRole('button', { name: /^Edit/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Delete/ })).toBeNull()
  })

  it('offers no controls at all when the timeline is read-only', () => {
    renderTimeline([NOTE], undefined, false)
    expect(screen.queryByRole('button', { name: EDIT_NOTE })).toBeNull()
    expect(screen.queryByRole('button', { name: DELETE_NOTE })).toBeNull()
  })
})
