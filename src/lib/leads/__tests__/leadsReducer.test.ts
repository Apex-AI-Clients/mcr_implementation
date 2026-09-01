import { describe, it, expect } from 'vitest'
import { leadsReducer, type LeadsState } from '@/components/leads/LeadsStore'
import { needsFollowUp } from '../followUp'
import type { Lead, LeadActivity } from '@/types/leads'

/**
 * The follow-up clock rules, tested where they actually live.
 *
 * The client's objection was that opening a record used to count as contact.
 * These assertions pin down what does and does not reset `lastActionAt`.
 */

const NOW = new Date('2026-09-01T02:00:00.000Z')
const DAY_MS = 86_400_000

function at(daysBefore: number): string {
  return new Date(NOW.getTime() - daysBefore * DAY_MS).toISOString()
}

/** A lead that is open and long overdue — flagged until something resets it. */
function staleLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: 'ld_1',
    name: 'Sasha Lorenz',
    email: 'sasha@example.com.au',
    phone: '0421004772',
    debtAmount: 6_400_000,
    state: 'NSW',
    stage: 'lead',
    source: 'facebook',
    company: null,
    nextStep: null,
    stageSince: at(40),
    lastActionAt: at(40),
    convertedClientId: null,
    createdAt: at(40),
    updatedAt: at(40),
    ...overrides,
  }
}

function stateWith(lead: Lead, activities: LeadActivity[] = []): LeadsState {
  return { leads: [lead], activities }
}

function activity(overrides: Partial<LeadActivity> = {}): LeadActivity {
  return {
    id: 'act_new',
    leadId: 'ld_1',
    type: 'call',
    body: 'Spoke to the director.',
    author: 'Gabby',
    createdAt: NOW.toISOString(),
    ...overrides,
  }
}

describe('follow-up clock', () => {
  it('flags a stale open lead to begin with', () => {
    expect(needsFollowUp(staleLead(), NOW)).toBe(true)
  })

  it('clears the flag when an action is logged', () => {
    const next = leadsReducer(stateWith(staleLead()), {
      type: 'LOG_ACTIVITY',
      activity: activity(),
    })
    expect(next.leads[0].lastActionAt).toBe(NOW.toISOString())
    expect(needsFollowUp(next.leads[0], NOW)).toBe(false)
  })

  it.each(['note', 'call', 'email', 'next_step'] as const)(
    'clears the flag for a logged %s',
    (type) => {
      const next = leadsReducer(stateWith(staleLead()), {
        type: 'LOG_ACTIVITY',
        activity: activity({ type }),
      })
      expect(needsFollowUp(next.leads[0], NOW)).toBe(false)
    },
  )

  it('keeps the flag when a contact field is edited', () => {
    // Correcting a phone number is not evidence anyone contacted the lead.
    const next = leadsReducer(stateWith(staleLead()), {
      type: 'UPDATE_LEAD',
      leadId: 'ld_1',
      patch: { phone: '0400000000' },
      at: NOW.toISOString(),
    })
    expect(next.leads[0].phone).toBe('0400000000')
    expect(next.leads[0].lastActionAt).toBe(at(40))
    expect(needsFollowUp(next.leads[0], NOW)).toBe(true)
  })

  it('survives reading the record — no action means no state change', () => {
    const before = stateWith(staleLead())
    // Opening /leads/[id] only reads from the store. Nothing is dispatched, so
    // the flag is still there when the user returns to the list.
    expect(needsFollowUp(before.leads[0], NOW)).toBe(true)
  })

  it('clears the flag on a stage change', () => {
    const next = leadsReducer(stateWith(staleLead()), {
      type: 'SET_STAGE',
      leadId: 'ld_1',
      stage: 'prospect',
      activity: activity({ type: 'stage_change' }),
      at: NOW.toISOString(),
    })
    expect(next.leads[0].stage).toBe('prospect')
    expect(next.leads[0].stageSince).toBe(NOW.toISOString())
    expect(needsFollowUp(next.leads[0], NOW)).toBe(false)
  })
})

describe('leadsReducer', () => {
  it('records a next step on the lead as well as the timeline', () => {
    const next = leadsReducer(stateWith(staleLead()), {
      type: 'LOG_ACTIVITY',
      activity: activity({ type: 'next_step', body: 'Send engagement letter.' }),
      nextStep: 'Send engagement letter.',
    })
    expect(next.leads[0].nextStep).toBe('Send engagement letter.')
    expect(next.activities).toHaveLength(1)
  })

  it('leaves an existing next step alone for other activity types', () => {
    const lead = staleLead({ nextStep: 'Chase the BAS.' })
    const next = leadsReducer(stateWith(lead), { type: 'LOG_ACTIVITY', activity: activity() })
    expect(next.leads[0].nextStep).toBe('Chase the BAS.')
  })

  it('prepends a new lead and keeps its opening note', () => {
    const lead = staleLead()
    const fresh = staleLead({ id: 'ld_2', name: 'New Lead' })
    const next = leadsReducer(stateWith(lead), {
      type: 'ADD_LEAD',
      lead: fresh,
      activity: activity({ id: 'act_first', leadId: 'ld_2', type: 'note' }),
    })
    expect(next.leads.map((l) => l.id)).toEqual(['ld_2', 'ld_1'])
    expect(next.activities).toHaveLength(1)
  })

  it('adds a lead with no note without inventing an activity', () => {
    const next = leadsReducer(stateWith(staleLead()), {
      type: 'ADD_LEAD',
      lead: staleLead({ id: 'ld_2' }),
      activity: null,
    })
    expect(next.activities).toHaveLength(0)
  })

  it('sets the client id and stage on conversion', () => {
    const next = leadsReducer(stateWith(staleLead()), {
      type: 'SET_CONVERTED',
      leadId: 'ld_1',
      clientId: 'client-123',
      activity: activity({ type: 'stage_change' }),
      at: NOW.toISOString(),
    })
    expect(next.leads[0].stage).toBe('client')
    expect(next.leads[0].convertedClientId).toBe('client-123')
  })

  it('rolls a failed stage change back and drops its activity', () => {
    const before = staleLead()
    const optimistic = leadsReducer(stateWith(before), {
      type: 'SET_STAGE',
      leadId: 'ld_1',
      stage: 'prospect',
      activity: activity({ id: 'act_optimistic', type: 'stage_change' }),
      at: NOW.toISOString(),
    })
    expect(optimistic.leads[0].stage).toBe('prospect')

    const rolledBack = leadsReducer(optimistic, {
      type: 'ROLLBACK_LEAD',
      lead: before,
      removeActivityId: 'act_optimistic',
    })
    expect(rolledBack.leads[0]).toEqual(before)
    expect(rolledBack.activities).toHaveLength(0)
    expect(needsFollowUp(rolledBack.leads[0], NOW)).toBe(true)
  })

  it('does not mutate the previous state', () => {
    const before = stateWith(staleLead())
    const snapshot = structuredClone(before)
    leadsReducer(before, { type: 'LOG_ACTIVITY', activity: activity() })
    expect(before).toEqual(snapshot)
  })
})
