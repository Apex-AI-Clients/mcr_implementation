import { describe, it, expect, vi } from 'vitest'
import { EMPTY_FILTERS, type LeadFilterState } from '../filter'

vi.mock('@/lib/supabase/server', () => ({ getSupabaseServerClient: vi.fn() }))

import { withFilters, type LeadsFilterable } from '../queries'

/**
 * The SQL side of the filters, checked against a builder that records what it
 * was asked for. What PostgREST then does with those calls is its business;
 * what matters here is that the list and the export ask for the same thing as
 * filterLeads() decides on screen.
 */

type Call = [method: string, ...args: unknown[]]

class Recorder implements LeadsFilterable<Recorder> {
  calls: Call[] = []
  private record(...call: Call): Recorder {
    this.calls.push(call)
    return this
  }
  eq(column: string, value: unknown) {
    return this.record('eq', column, value)
  }
  in(column: string, values: readonly unknown[]) {
    return this.record('in', column, values)
  }
  or(filters: string) {
    return this.record('or', filters)
  }
  gte(column: string, value: unknown) {
    return this.record('gte', column, value)
  }
  lt(column: string, value: unknown) {
    return this.record('lt', column, value)
  }
  order(column: string, options: { ascending: boolean; nullsFirst?: boolean }) {
    return this.record('order', column, options)
  }
}

function callsFor(patch: Partial<LeadFilterState>): Call[] {
  return withFilters(new Recorder(), { ...EMPTY_FILTERS, ...patch }, new Date()).calls
}

describe('withFilters — state', () => {
  it('matches the state or a grouping that contains it, as mightBeInState() does', () => {
    expect(callsFor({ state: 'NSW' })).toEqual([
      ['or', 'state.eq.NSW,meta_state_options.cs.{NSW}'],
    ])
  })

  it('adds no state condition when the filter is off', () => {
    expect(callsFor({})).toEqual([])
  })

  it('combines with another or() filter rather than replacing it', () => {
    // Each or() is its own condition, ANDed with the rest — the debt floor must
    // not widen the state match, nor the reverse.
    const calls = callsFor({ state: 'VIC', debtFloor: 100_000 })
    expect(calls).toContainEqual(['or', 'state.eq.VIC,meta_state_options.cs.{VIC}'])
    expect(calls.filter(([method]) => method === 'or')).toHaveLength(2)
  })
})
