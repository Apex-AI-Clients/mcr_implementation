import { describe, it, expect, vi, afterEach } from 'vitest'
import { EMPTY_FILTERS, type LeadFilterState } from '../filter'

vi.mock('@/lib/supabase/server', () => ({ getSupabaseServerClient: vi.fn() }))

import { getSupabaseServerClient } from '@/lib/supabase/server'
import {
  getConvertedClientDetails,
  withFilters,
  withLatestEnquirySources,
  withSort,
  type LeadsFilterable,
} from '../queries'
import type { Lead } from '@/types/leads'

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

describe('withFilters and withSort — latest enquiry', () => {
  it('filters the date range on the latest enquiry, not the date added', () => {
    const calls = callsFor({ dateRange: '30' })
    expect(calls).toHaveLength(1)
    expect(calls[0].slice(0, 2)).toEqual(['gte', 'last_enquiry_at'])
  })

  it('sorts newest enquiry first', () => {
    expect(withSort(new Recorder(), 'recent').calls).toEqual([
      ['order', 'last_enquiry_at', { ascending: false }],
    ])
  })

  it('breaks debt ties by newest enquiry', () => {
    expect(withSort(new Recorder(), 'debt').calls).toEqual([
      ['order', 'debt_min', { ascending: false, nullsFirst: false }],
      ['order', 'last_enquiry_at', { ascending: false }],
    ])
  })
})

describe('withLatestEnquirySources', () => {
  const lead = (id: string, latestEnquirySource: Lead['latestEnquirySource']) =>
    ({ id, latestEnquirySource }) as Lead

  function mockSubmissions(read: { data: unknown; error: { message: string } | null }) {
    const inFn = vi.fn(() => chain)
    const chain = {
      select: () => chain,
      in: inFn,
      order: () => Promise.resolve(read),
    }
    const from = vi.fn(() => chain)
    vi.mocked(getSupabaseServerClient).mockReturnValue({ from } as never)
    return { from, inFn }
  }

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('makes no request when every source is already known', async () => {
    const { from } = mockSubmissions({ data: [], error: null })
    const leads = [lead('a', 'facebook')]
    expect(await withLatestEnquirySources(leads)).toBe(leads)
    expect(from).not.toHaveBeenCalled()
  })

  it('asks only for the leads that need it and takes each one’s newest row', async () => {
    const { inFn } = mockSubmissions({
      data: [
        // Newest first, as ordered.
        { lead_id: 'b', source: 'website' },
        { lead_id: 'c', source: 'google_form' },
        { lead_id: 'b', source: 'facebook' },
      ],
      error: null,
    })
    const result = await withLatestEnquirySources([
      lead('a', 'facebook'),
      lead('b', null),
      lead('c', null),
    ])
    expect(inFn).toHaveBeenCalledWith('lead_id', ['b', 'c'])
    expect(result.map((l) => l.latestEnquirySource)).toEqual(['facebook', 'website', 'google_form'])
  })

  it('leaves the source unknown rather than failing the page', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockSubmissions({ data: null, error: { message: 'boom' } })
    const result = await withLatestEnquirySources([lead('b', null)])
    expect(result[0].latestEnquirySource).toBeNull()
  })
})

describe('getConvertedClientDetails', () => {
  type Read = { data: unknown; error: { message: string } | null }

  /** A client whose from(table)...maybeSingle() resolves to the given read. */
  function mockTables(reads: Record<string, Read>) {
    const from = vi.fn((table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: () => Promise.resolve(reads[table]),
      }
      return chain
    })
    vi.mocked(getSupabaseServerClient).mockReturnValue({ from } as never)
  }

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const CLIENT = {
    id: 'cl_1',
    name: 'Dean Whitlock',
    email: 'dean@whitlockcivil.com.au',
    phone: '0407552118',
  }

  it('joins the client to its company details', async () => {
    mockTables({
      clients: { data: CLIENT, error: null },
      company_details: {
        data: {
          company_name: 'Whitlock Civil Pty Ltd',
          acn_number: '004085616',
          abn_number: '53004085616',
          trust_name: null,
          phone_number: '0745359847',
          email_address: 'accounts@whitlockcivil.com.au',
        },
        error: null,
      },
    })

    expect(await getConvertedClientDetails('cl_1')).toEqual({
      id: 'cl_1',
      name: 'Dean Whitlock',
      email: 'dean@whitlockcivil.com.au',
      phone: '0407552118',
      companyName: 'Whitlock Civil Pty Ltd',
      acnNumber: '004085616',
      abnNumber: '53004085616',
      trustName: null,
      companyPhone: '0745359847',
      companyEmail: 'accounts@whitlockcivil.com.au',
    })
  })

  it('still returns the client when it has no company details yet', async () => {
    mockTables({
      clients: { data: CLIENT, error: null },
      company_details: { data: null, error: null },
    })
    const result = await getConvertedClientDetails('cl_1')
    expect(result?.name).toBe('Dean Whitlock')
    expect(result?.abnNumber).toBeNull()
  })

  it('still returns the client when the company read fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockTables({
      clients: { data: CLIENT, error: null },
      company_details: { data: null, error: { message: 'boom' } },
    })
    expect((await getConvertedClientDetails('cl_1'))?.id).toBe('cl_1')
  })

  it('is null when the client file no longer exists', async () => {
    mockTables({
      clients: { data: null, error: null },
      company_details: { data: null, error: null },
    })
    expect(await getConvertedClientDetails('cl_gone')).toBeNull()
  })
})
