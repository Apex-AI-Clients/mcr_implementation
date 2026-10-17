import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, within, cleanup } from '@testing-library/react'
import { LeadRecordClient } from '../LeadRecordClient'
import { StageProgress } from '../StageProgress'
import { LeadsStoreProvider } from '../LeadsStore'
import { ToastProvider } from '@/components/ui/Toast'
import type { Lead, LeadActivity, LeadStage } from '@/types/leads'

/**
 * The record page's layout: the progress card, the key facts, one Activity
 * list, and the contact card. Plus the stage track itself, which never dates a
 * step it cannot actually know the date of. Synthetic data only.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/leads/ld_1',
}))

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
    sourceLabel: null,
    entityTypeLabel: null,
    company: null,
    nextStep: null,
    stageSince: '2026-08-20T00:00:00.000Z',
    lastActionAt: '2026-08-30T00:00:00.000Z',
    lastEnquiryAt: '2026-08-01T00:00:00.000Z',
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
    metaStateRaw: null,
    metaStateOptions: null,
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

function renderRecord(lead: Lead = makeLead(), activities = ACTIVITIES) {
  return render(
    <ToastProvider>
      <LeadsStoreProvider author="Gabby" initialLeads={[lead]} initialActivities={activities}>
        <LeadRecordClient
          leadId={lead.id}
          initialLead={lead}
          initialActivities={activities}
          enquiries={[]}
          convertedClient={null}
        />
      </LeadsStoreProvider>
    </ToastProvider>,
  )
}

function activitySection() {
  return screen.getByRole('region', { name: /Activity/ })
}

describe('Lead record — activity', () => {
  it('lists notes, calls, next steps and stage changes together', () => {
    renderRecord()
    const section = activitySection()
    expect(within(section).getByText('Spoke about the BAS arrears.')).toBeTruthy()
    expect(within(section).getByText('Called, left a voicemail.')).toBeTruthy()
    expect(within(section).getByText('Book the director meeting.')).toBeTruthy()
    expect(within(section).getByText('Stage changed from Lead to Prospect.')).toBeTruthy()
  })

  it('counts everything in the heading', () => {
    renderRecord()
    expect(screen.getByRole('heading', { name: /Activity/ }).textContent).toContain('4')
  })

  it('offers edit on composed entries, never on a stage change', () => {
    renderRecord()
    const section = activitySection()
    // Note, call and next step.
    expect(within(section).getAllByRole('button', { name: /^Edit / })).toHaveLength(3)
    expect(within(section).queryByRole('button', { name: /^Edit stage/i })).toBeNull()
  })

  it('says so when nothing has been recorded', () => {
    renderRecord(makeLead(), [])
    expect(within(activitySection()).getByText(/Nothing recorded yet/)).toBeTruthy()
  })
})

describe('Lead record — key facts and contact', () => {
  function facts() {
    return screen.getByText('Debt').closest('dl') as HTMLElement
  }

  it('shows debt, state, business type and next step', () => {
    renderRecord(makeLead({ nextStep: 'Book the director meeting.' }), [])
    expect(within(facts()).getByText('QLD')).toBeTruthy()
    expect(within(facts()).getByText('Company')).toBeTruthy()
    expect(within(facts()).getByText('Book the director meeting.')).toBeTruthy()
    expect(within(facts()).queryAllByText('Not given')).toHaveLength(0)
  })

  it('says plainly when a fact is not known', () => {
    renderRecord(makeLead({ debtMin: null, debtMax: null, state: null, entityType: null }))
    expect(within(facts()).getAllByText('Not given')).toHaveLength(3)
    expect(within(facts()).getByText('None set')).toBeTruthy()
  })

  it('warns on a trust', () => {
    renderRecord(makeLead({ entityType: 'trust' }))
    expect(screen.getByText('A trust cannot take the SBR path.')).toBeTruthy()
  })

  it('links the email and phone so they can be used straight away', () => {
    renderRecord(makeLead({ preferredCallTime: 'After 6pm', message: 'Civil contracting.' }))
    const contact = screen.getByRole('region', { name: 'Contact' })
    expect(
      within(contact).getByRole('link', { name: 'dean@whitlockcivil.com.au' }).getAttribute('href'),
    ).toBe('mailto:dean@whitlockcivil.com.au')
    expect(within(contact).getByRole('link', { name: /0407/ }).getAttribute('href')).toBe(
      'tel:0407552118',
    )
    expect(within(contact).getByText('After 6pm')).toBeTruthy()
    expect(within(contact).getByText('Civil contracting.')).toBeTruthy()
    expect(within(contact).getByRole('button', { name: 'Copy email' })).toBeTruthy()
    expect(within(contact).getByRole('button', { name: 'Copy phone' })).toBeTruthy()
  })

  it('has one way to edit details: the Edit button', () => {
    renderRecord(makeLead(), [])
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy()
    expect(
      screen.queryByRole('button', { name: /^Edit (email|phone|debt|business type)$/ }),
    ).toBeNull()
  })
})

describe('Lead record — progress', () => {
  it('puts the stage control and Convert beside the track', () => {
    renderRecord()
    const progress = screen.getByRole('region', { name: 'Progress' })
    expect(within(progress).getByRole('list', { name: 'Stage progress' })).toBeTruthy()
    expect(within(progress).getByRole('combobox')).toBeTruthy()
    expect(within(progress).getByRole('button', { name: /Convert to client/ })).toBeTruthy()
  })

  it('links to the client file once converted', () => {
    renderRecord(makeLead({ stage: 'converted', convertedClientId: 'client-1' }))
    const progress = screen.getByRole('region', { name: 'Progress' })
    expect(
      within(progress).getByRole('link', { name: /Open their client file/ }).getAttribute('href'),
    ).toBe('/clients/client-1')
  })
})

describe('StageProgress', () => {
  function renderTrack(lead: Lead) {
    render(<StageProgress lead={lead} />)
    return screen.getByRole('list', { name: 'Stage progress' })
  }

  it('draws the four progression stages, in order', () => {
    const steps = within(renderTrack(makeLead()))
      .getAllByRole('listitem')
      .map((item) => item.textContent ?? '')
    expect(steps).toHaveLength(4)
    expect(steps[0]).toContain('Lead')
    expect(steps[1]).toContain('Prospect')
    expect(steps[2]).toContain('Client')
    expect(steps[3]).toContain('Converted')
  })

  it('marks everything before the current stage as completed', () => {
    renderTrack(makeLead({ stage: 'client' }))
    // Lead and Prospect are behind it, so two ticks.
    expect(screen.getAllByText('Completed')).toHaveLength(2)
    expect(screen.getByText(/current stage/)).toBeTruthy()
  })

  it('dates only the steps it can actually know', () => {
    // The first step is the lead's own arrival and the current one is
    // stage_since. An intermediate step has no reliable date, and a guessed
    // one would be invention.
    const items = within(renderTrack(makeLead({ stage: 'converted' }))).getAllByRole('listitem')
    expect(items[0].textContent).toContain('1 Aug 2026')
    expect(items[3].textContent).toContain('20 Aug 2026')
    expect(items[1].textContent).not.toMatch(/\d{4}/)
    expect(items[2].textContent).not.toMatch(/\d{4}/)
  })

  it('says which step of how many', () => {
    renderTrack(makeLead({ stage: 'prospect' }))
    expect(screen.getByText('Step 2 of 4')).toBeTruthy()
  })

  it('drops the step counter once the lead has stopped', () => {
    // "Step 2 of 4" implies there are two more to go, which is exactly wrong
    // for a lead that is not going anywhere.
    renderTrack(makeLead({ stage: 'non_proceeding' }))
    expect(screen.queryByText(/^Step \d+ of/)).toBeNull()
  })

  it('treats a stopped lead as an exit, not a step', () => {
    const track = renderTrack(makeLead({ stage: 'do_not_contact' }))
    expect(screen.getByText(/Stopped at/)).toBeTruthy()
    expect(screen.getByText('Do not contact')).toBeTruthy()
    expect(within(track).getAllByRole('listitem')).toHaveLength(4)
    // Nothing is marked current or complete once it has stopped.
    expect(screen.queryByText('Completed')).toBeNull()
    expect(screen.queryByText(/current stage/)).toBeNull()
  })

  it.each(['non_proceeding', 'do_not_contact'] as LeadStage[])('shows %s as a stop', (stage) => {
    renderTrack(makeLead({ stage }))
    expect(screen.getByText(/Stopped at/)).toBeTruthy()
  })
})
