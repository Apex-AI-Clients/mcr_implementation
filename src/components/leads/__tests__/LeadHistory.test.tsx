import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, within, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LeadHistory } from '../LeadHistory'
import { LeadsStoreProvider } from '../LeadsStore'
import { ToastProvider } from '@/components/ui/Toast'
import type { Lead, LeadActivity, LeadStage } from '@/types/leads'

/**
 * The record's history tabs and the stage track.
 *
 * Two things worth pinning: the split puts everything a person composed on
 * one side and only system-written stage changes on the other, and the track
 * never dates a step it cannot actually know the date of.
 */

afterEach(cleanup)

function makeLead(overrides: Partial<Lead> = {}): Lead {
  return {
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
    nextStep: null,
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
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-30T00:00:00.000Z',
    ...overrides,
  }
}

function activity(overrides: Partial<LeadActivity>): LeadActivity {
  return {
    id: 'ac_1',
    leadId: 'ld_1',
    type: 'note',
    body: 'Body',
    author: 'Gabby',
    createdAt: '2026-08-10T00:00:00.000Z',
    ...overrides,
  }
}

const ACTIVITIES: LeadActivity[] = [
  activity({ id: 'a1', type: 'note', body: 'Spoke about the BAS arrears.' }),
  activity({ id: 'a2', type: 'call', body: 'Called, left a voicemail.' }),
  activity({ id: 'a3', type: 'next_step', body: 'Book the director meeting.' }),
  activity({ id: 'a4', type: 'stage_change', body: 'Stage changed from Lead to Prospect.' }),
]

/**
 * The timeline can now edit and delete entries, so it reads the store and the
 * toaster — both have to be present even for the read-only assertions here.
 */
function renderHistory(lead: Lead = makeLead(), activities = ACTIVITIES) {
  return render(
    <ToastProvider>
      <LeadsStoreProvider author="Gabby" initialLeads={[lead]} initialActivities={activities}>
        <LeadHistory lead={lead} activities={activities} />
      </LeadsStoreProvider>
    </ToastProvider>,
  )
}

/**
 * The visible panel. Matched loosely because the tab that labels it carries a
 * count too, so its accessible name is "Notes 3", not "Notes".
 */
function panel(name: 'Notes' | 'Stage') {
  return screen.getByRole('tabpanel', { name: new RegExp(name) })
}

describe('LeadHistory tabs', () => {
  it('opens on Notes', () => {
    renderHistory()
    expect(screen.getByRole('tab', { name: /Notes/ }).getAttribute('aria-selected')).toBe('true')
  })

  it('keeps composed entries and stage changes apart', () => {
    // A call sitting between two stage changes was the noise this split exists
    // to remove.
    renderHistory()

    const notes = panel('Notes')
    expect(within(notes).getByText('Spoke about the BAS arrears.')).toBeTruthy()
    expect(within(notes).getByText('Called, left a voicemail.')).toBeTruthy()
    expect(within(notes).getByText('Book the director meeting.')).toBeTruthy()
    expect(within(notes).queryByText(/Stage changed from/)).toBeNull()
  })

  it('shows the stage changes on the Stage tab', async () => {
    const user = userEvent.setup()
    renderHistory()

    await user.click(screen.getByRole('tab', { name: /Stage/ }))

    const stage = panel('Stage')
    expect(within(stage).getByText('Stage changed from Lead to Prospect.')).toBeTruthy()
    expect(within(stage).queryByText('Called, left a voicemail.')).toBeNull()
  })

  it('counts what is on each tab', () => {
    renderHistory()
    // Three composed entries, one stage change.
    expect(screen.getByRole('tab', { name: /Notes/ }).textContent).toContain('3')
    expect(screen.getByRole('tab', { name: /Stage/ }).textContent).toContain('1')
  })

  it('moves between tabs with the arrow keys', async () => {
    // The tablist pattern: only the selected tab is tabbable, arrows do the
    // rest.
    const user = userEvent.setup()
    renderHistory()

    const notes = screen.getByRole('tab', { name: /Notes/ })
    notes.focus()
    await user.keyboard('{ArrowRight}')

    expect(screen.getByRole('tab', { name: /Stage/ }).getAttribute('aria-selected')).toBe('true')
    expect(notes.getAttribute('tabindex')).toBe('-1')
  })

  it('says so when a lead has no stage changes yet', async () => {
    const user = userEvent.setup()
    renderHistory(makeLead(), [ACTIVITIES[0]])

    await user.click(screen.getByRole('tab', { name: /Stage/ }))
    expect(within(panel('Stage')).getByText(/No stage changes yet/)).toBeTruthy()
  })
})

describe('StageProgress', () => {
  async function openStage(lead: Lead) {
    const user = userEvent.setup()
    renderHistory(lead)
    await user.click(screen.getByRole('tab', { name: /Stage/ }))
    return panel('Stage')
  }

  /** The track alone — the panel also holds the stage-change cards. */
  function track(stage: HTMLElement) {
    return within(within(stage).getByRole('list', { name: 'Stage progress' }))
  }

  it('draws the four progression stages, in order', async () => {
    const stage = await openStage(makeLead())
    const steps = track(stage)
      .getAllByRole('listitem')
      .map((item) => item.textContent ?? '')
    expect(steps).toHaveLength(4)
    expect(steps[0]).toContain('Lead')
    expect(steps[1]).toContain('Prospect')
    expect(steps[2]).toContain('Client')
    expect(steps[3]).toContain('Converted')
  })

  it('marks everything before the current stage as completed', async () => {
    const stage = await openStage(makeLead({ stage: 'client' }))
    // Lead and Prospect are behind it, so two ticks.
    expect(within(stage).getAllByText('Completed')).toHaveLength(2)
    expect(within(stage).getByText(/current stage/)).toBeTruthy()
  })

  it('dates only the steps it can actually know', async () => {
    // The first step is the lead's own arrival and the current one is
    // stage_since. An intermediate step has no reliable date, and a guessed
    // one would be invention.
    const stage = await openStage(makeLead({ stage: 'converted' }))
    const items = track(stage).getAllByRole('listitem')

    expect(items[0].textContent).toContain('1 Aug 2026')
    expect(items[3].textContent).toContain('20 Aug 2026')
    // Prospect and Client sit between the two and carry no date.
    expect(items[1].textContent).not.toMatch(/\d{4}/)
    expect(items[2].textContent).not.toMatch(/\d{4}/)
  })

  it('says which step of how many', async () => {
    const stage = await openStage(makeLead({ stage: 'prospect' }))
    expect(within(stage).getByText('Step 2 of 4')).toBeTruthy()
  })

  it('drops the step counter once the lead has stopped', async () => {
    // "Step 2 of 4" implies there are two more to go, which is exactly wrong
    // for a lead that is not going anywhere.
    const stage = await openStage(makeLead({ stage: 'non_proceeding' }))
    expect(within(stage).queryByText(/^Step \d+ of/)).toBeNull()
  })

  it('treats a stopped lead as an exit, not a step', async () => {
    // "Do not contact" must never appear on the track as something to work
    // towards.
    const stage = await openStage(makeLead({ stage: 'do_not_contact' }))

    expect(within(stage).getByText(/Stopped at/)).toBeTruthy()
    expect(within(stage).getByText('Do not contact')).toBeTruthy()
    const steps = track(stage).getAllByRole('listitem')
    expect(steps).toHaveLength(4)
    // Nothing is marked current or complete once it has stopped.
    expect(within(stage).queryByText('Completed')).toBeNull()
    expect(within(stage).queryByText(/current stage/)).toBeNull()
  })

  it.each(['non_proceeding', 'do_not_contact'] as LeadStage[])(
    'shows %s as a stop',
    async (stage) => {
      const panelEl = await openStage(makeLead({ stage }))
      expect(within(panelEl).getByText(/Stopped at/)).toBeTruthy()
    },
  )
})
