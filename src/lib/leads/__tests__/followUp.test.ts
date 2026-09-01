import { describe, it, expect } from 'vitest'
import {
  FOLLOW_UP_DAYS,
  needsFollowUp,
  countOpenLeads,
  countNeedingFollowUp,
} from '../followUp'
import type { Lead, LeadStage } from '@/types/leads'

// Fixed clock — these assertions must not drift with the wall clock.
const NOW = new Date('2026-09-01T10:00:00.000Z')
const DAY_MS = 86_400_000

function at(daysBefore: number): string {
  return new Date(NOW.getTime() - daysBefore * DAY_MS).toISOString()
}

function makeLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: 'ld_test',
    name: 'Test Lead',
    email: 'test@example.com.au',
    phone: '0400 000 000',
    debtAmount: 5_000_000,
    state: 'NSW',
    stage: 'lead',
    source: 'manual',
    company: null,
    nextStep: null,
    stageSince: at(60),
    lastActionAt: at(60),
    convertedClientId: null,
    createdAt: at(60),
    updatedAt: at(60),
    ...overrides,
  }
}

const CLOSED_STAGES: LeadStage[] = ['converted', 'non_proceeding', 'do_not_contact']
const OPEN_STAGES: LeadStage[] = ['lead', 'prospect', 'client']

describe('needsFollowUp', () => {
  it('does not flag an open lead at 29 days', () => {
    expect(needsFollowUp(makeLead({ lastActionAt: at(29) }), NOW)).toBe(false)
  })

  it('flags an open lead at 31 days', () => {
    expect(needsFollowUp(makeLead({ lastActionAt: at(31) }), NOW)).toBe(true)
  })

  it('does not flag exactly at the threshold — the rule is strictly greater than', () => {
    expect(needsFollowUp(makeLead({ lastActionAt: at(FOLLOW_UP_DAYS) }), NOW)).toBe(false)
  })

  it('flags one millisecond past the threshold', () => {
    const justOver = new Date(NOW.getTime() - (FOLLOW_UP_DAYS * DAY_MS + 1)).toISOString()
    expect(needsFollowUp(makeLead({ lastActionAt: justOver }), NOW)).toBe(true)
  })

  it.each(OPEN_STAGES)('flags a stale %s', (stage) => {
    expect(needsFollowUp(makeLead({ stage, lastActionAt: at(45) }), NOW)).toBe(true)
  })

  it.each(CLOSED_STAGES)('never flags %s, however stale', (stage) => {
    expect(needsFollowUp(makeLead({ stage, lastActionAt: at(365) }), NOW)).toBe(false)
  })

  it('flags a lead whose only activity predates the threshold', () => {
    // lastActionAt is the clock; the lead was created long ago and nothing has
    // been recorded since.
    const lead = makeLead({ createdAt: at(90), lastActionAt: at(90), stage: 'prospect' })
    expect(needsFollowUp(lead, NOW)).toBe(true)
  })

  it('is not reset by a recent createdAt or stageSince alone', () => {
    // Only lastActionAt moves the clock. A stage that changed recently without
    // a recorded action must not clear the flag.
    const lead = makeLead({ stageSince: at(1), createdAt: at(1), lastActionAt: at(40) })
    expect(needsFollowUp(lead, NOW)).toBe(true)
  })

  it('defaults `now` to the current time', () => {
    const fresh = makeLead({ lastActionAt: new Date().toISOString() })
    expect(needsFollowUp(fresh)).toBe(false)
  })
})

describe('countOpenLeads', () => {
  it('counts only open stages', () => {
    const leads = [
      makeLead({ id: 'a', stage: 'lead' }),
      makeLead({ id: 'b', stage: 'prospect' }),
      makeLead({ id: 'c', stage: 'client' }),
      makeLead({ id: 'd', stage: 'converted' }),
      makeLead({ id: 'e', stage: 'non_proceeding' }),
      makeLead({ id: 'f', stage: 'do_not_contact' }),
    ]
    expect(countOpenLeads(leads)).toBe(3)
  })

  it('is zero for an empty list', () => {
    expect(countOpenLeads([])).toBe(0)
  })
})

describe('countNeedingFollowUp', () => {
  it('counts stale open leads and ignores stale closed ones', () => {
    const leads = [
      makeLead({ id: 'a', stage: 'lead', lastActionAt: at(31) }),
      makeLead({ id: 'b', stage: 'prospect', lastActionAt: at(90) }),
      makeLead({ id: 'c', stage: 'lead', lastActionAt: at(2) }),
      makeLead({ id: 'd', stage: 'converted', lastActionAt: at(200) }),
      makeLead({ id: 'e', stage: 'do_not_contact', lastActionAt: at(200) }),
    ]
    expect(countNeedingFollowUp(leads, NOW)).toBe(2)
  })

  it('is zero when everything is recent', () => {
    const leads = [makeLead({ lastActionAt: at(1) }), makeLead({ lastActionAt: at(5) })]
    expect(countNeedingFollowUp(leads, NOW)).toBe(0)
  })
})
