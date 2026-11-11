import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ getSupabaseServerClient: vi.fn() }))

import { getSupabaseServerClient } from '@/lib/supabase/server'
import {
  planRawStateRenormalise,
  planStateBackfill,
  runRawStateRenormalise,
  runStateBackfill,
  stateColumns,
  STATE_BACKFILL_FORM_ID,
  type BackfillAnswer,
  type BackfillLead,
  type BackfillSubmission,
} from '../stateBackfill'

/**
 * The one-off State backfill for form 1751128836351174. Synthetic data only.
 *
 * The rule that matters most: a State column that has anything in it is never
 * touched — not on the lead row, not on an enquiry row.
 */

const EMPTY = { state: null, meta_state_raw: null, meta_state_options: null }

function sub(id: string, leadId: string, receivedAt: string, extra: Partial<BackfillSubmission> = {}) {
  return {
    id,
    lead_id: leadId,
    external_id: `leadgen-${id}`,
    meta_page_id: 'page-1',
    received_at: receivedAt,
    ...EMPTY,
    ...extra,
  } as BackfillSubmission
}

function lead(id: string, extra: Partial<BackfillLead> = {}): BackfillLead {
  return { id, ...EMPTY, ...extra } as BackfillLead
}

const found = (mapping: BackfillAnswer & { kind: 'found' }): BackfillAnswer => mapping

describe('stateColumns', () => {
  it('writes a single state to state only', () => {
    expect(stateColumns({ kind: 'state', state: 'VIC' })).toEqual({
      state: 'VIC',
      meta_state_raw: null,
      meta_state_options: null,
    })
  })

  it('writes a group to the options and its label, never to state', () => {
    expect(stateColumns({ kind: 'group', states: ['NSW', 'VIC'], label: 'NSW, VIC' })).toEqual({
      state: null,
      meta_state_raw: 'NSW, VIC',
      meta_state_options: ['NSW', 'VIC'],
    })
  })

  it('keeps an unrecognised answer verbatim as raw text', () => {
    expect(stateColumns({ kind: 'unresolved', raw: 'Gold Coast' })).toEqual({
      state: null,
      meta_state_raw: 'Gold Coast',
      meta_state_options: null,
    })
  })

  it('writes nothing for no answer', () => {
    expect(stateColumns({ kind: 'absent' })).toBeNull()
  })
})

describe('planStateBackfill', () => {
  it('fills blank enquiries and leads, and counts each outcome', () => {
    const submissions = [
      sub('s1', 'l1', '2026-11-05T00:00:00Z'),
      sub('s2', 'l2', '2026-11-06T00:00:00Z'),
      sub('s3', 'l3', '2026-11-07T00:00:00Z'),
      sub('s4', 'l4', '2026-11-08T00:00:00Z'),
    ]
    const leads = [lead('l1'), lead('l2'), lead('l3'), lead('l4')]
    const answers = new Map<string, BackfillAnswer>([
      ['s1', found({ kind: 'found', mapping: { kind: 'state', state: 'QLD' } })],
      ['s2', found({ kind: 'found', mapping: { kind: 'unresolved', raw: 'Gold Coast' } })],
      ['s3', found({ kind: 'found', mapping: { kind: 'absent' } })],
      ['s4', { kind: 'not_found' }],
    ])

    const plan = planStateBackfill(submissions, leads, answers)
    expect(plan.counts).toEqual({
      submissions: 4,
      found: 3,
      notFound: 1,
      recognised: 1,
      unrecognisedAnswer: 1,
      blankInMeta: 1,
      submissionsFilled: 2,
      submissionsAlreadySet: 0,
      leadsFilled: 2,
      leadsAlreadySet: 0,
    })
    expect(plan.submissionUpdates.map((u) => u.id)).toEqual(['s1', 's2'])
    expect(plan.leadUpdates).toEqual([
      { id: 'l1', columns: { state: 'QLD', meta_state_raw: null, meta_state_options: null } },
      { id: 'l2', columns: { state: null, meta_state_raw: 'Gold Coast', meta_state_options: null } },
    ])
  })

  it.each<[string, Partial<BackfillLead>]>([
    ['a state', { state: 'NSW' }],
    ['raw text', { meta_state_raw: 'somewhere' }],
    ['state options', { meta_state_options: ['NSW', 'VIC'] }],
  ])('never touches a lead that already has %s', (_label, existing) => {
    const plan = planStateBackfill(
      [sub('s1', 'l1', '2026-11-05T00:00:00Z')],
      [lead('l1', existing)],
      new Map([['s1', found({ kind: 'found', mapping: { kind: 'state', state: 'QLD' } })]]),
    )
    expect(plan.leadUpdates).toEqual([])
    expect(plan.counts.leadsAlreadySet).toBe(1)
    expect(plan.counts.leadsFilled).toBe(0)
  })

  it('never touches an enquiry that already has a State', () => {
    const plan = planStateBackfill(
      [sub('s1', 'l1', '2026-11-05T00:00:00Z', { state: 'WA' })],
      [lead('l1')],
      new Map([['s1', found({ kind: 'found', mapping: { kind: 'state', state: 'QLD' } })]]),
    )
    expect(plan.submissionUpdates).toEqual([])
    expect(plan.counts.submissionsAlreadySet).toBe(1)
  })

  it('gives the lead its latest answered enquiry, whatever order they arrive in', () => {
    const plan = planStateBackfill(
      [
        sub('later', 'l1', '2026-11-09T00:00:00Z'),
        sub('earlier', 'l1', '2026-11-05T00:00:00Z'),
        sub('latest-blank', 'l1', '2026-11-10T00:00:00Z'),
      ],
      [lead('l1')],
      new Map<string, BackfillAnswer>([
        ['later', found({ kind: 'found', mapping: { kind: 'state', state: 'SA' } })],
        ['earlier', found({ kind: 'found', mapping: { kind: 'state', state: 'NT' } })],
        // A skipped question does not blank out the answer before it.
        ['latest-blank', found({ kind: 'found', mapping: { kind: 'absent' } })],
      ]),
    )
    expect(plan.leadUpdates).toEqual([
      { id: 'l1', columns: { state: 'SA', meta_state_raw: null, meta_state_options: null } },
    ])
    expect(plan.counts.submissionsFilled).toBe(2)
  })

  it('leaves a lead alone when Meta returned none of its enquiries', () => {
    const plan = planStateBackfill([sub('s1', 'l1', '2026-11-05T00:00:00Z')], [lead('l1')], new Map())
    expect(plan.counts.notFound).toBe(1)
    expect(plan.leadUpdates).toEqual([])
  })
})

describe('runStateBackfill', () => {
  // A minimal stand-in for the query builder: records every update and its
  // filters, and answers reads from fixed rows.
  const updates: Array<{ table: string; columns: unknown; filters: string[] }> = []
  let submissions: BackfillSubmission[] = []
  let leads: BackfillLead[] = []

  function builder(table: string) {
    const filters: string[] = []
    let columns: unknown = null
    const chain = {
      select: () => chain,
      eq: (col: string, val: string) => (filters.push(`${col}=${val}`), chain),
      in: () => chain,
      is: (col: string) => (filters.push(`${col} is null`), chain),
      update: (cols: unknown) => ((columns = cols), chain),
      then: (resolve: (v: unknown) => void) => {
        if (columns) {
          updates.push({ table, columns, filters })
          return resolve({ data: [{ id: 'x' }], error: null })
        }
        return resolve({ data: table === 'leads' ? leads : submissions, error: null })
      },
    }
    return chain
  }

  beforeEach(() => {
    updates.length = 0
    submissions = [sub('s1', 'l1', '2026-11-05T00:00:00Z')]
    leads = [lead('l1')]
    vi.mocked(getSupabaseServerClient).mockReturnValue({ from: builder } as never)
  })

  const fetchVic = vi.fn(async () => ({
    formId: STATE_BACKFILL_FORM_ID,
    fieldData: [
      { name: 'full_name', values: ['Test Person'] },
      { name: 'which_australian_state_are_you_in?_(e.g._vic,_nsw,_qld)', values: ['vic'] },
    ],
  }))

  it('writes nothing on a dry run, and reports counts only', async () => {
    const result = await runStateBackfill({ dryRun: true }, fetchVic)
    expect(updates).toEqual([])
    expect(result.dryRun).toBe(true)
    expect(result.expectedEnquiries).toBe(16)
    expect(result.counts).toMatchObject({ found: 1, recognised: 1, submissionsFilled: 1, leadsFilled: 1 })
    expect(JSON.stringify(result)).not.toMatch(/Test Person|leadgen-|"l1"|"s1"/)
  })

  it('guards every write on all three State columns being empty', async () => {
    await runStateBackfill({ dryRun: false }, fetchVic)
    expect(updates).toHaveLength(2)
    for (const update of updates) {
      expect(update.columns).toEqual({ state: 'VIC', meta_state_raw: null, meta_state_options: null })
      expect(update.filters).toEqual(
        expect.arrayContaining(['state is null', 'meta_state_raw is null', 'meta_state_options is null']),
      )
    }
    expect(updates.map((u) => u.table)).toEqual(['lead_submissions', 'leads'])
  })

  it('reads only the one form', async () => {
    const seen: string[] = []
    vi.mocked(getSupabaseServerClient).mockReturnValue({
      from: (table: string) => {
        const chain = builder(table)
        const eq = chain.eq
        chain.eq = (col: string, val: string) => (seen.push(`${col}=${val}`), eq(col, val))
        return chain
      },
    } as never)
    await runStateBackfill({ dryRun: true }, fetchVic)
    expect(seen).toContain(`meta_form_id=${STATE_BACKFILL_FORM_ID}`)
    expect(seen).toContain('source=facebook')
  })
})

describe('planRawStateRenormalise', () => {
  it('updates only rows that now read as exactly one state, and reports before → after', () => {
    const plan = planRawStateRenormalise([
      { id: 'a', meta_state_raw: 'N.S.W.' },
      { id: 'b', meta_state_raw: 'Melbourne' },
      { id: 'c', meta_state_raw: 'Vic.' },
      { id: 'd', meta_state_raw: 'vic / nsw' },
      { id: 'e', meta_state_raw: 'Auckland' },
    ])
    expect(plan.updates).toEqual([
      { id: 'a', raw: 'N.S.W.', state: 'NSW' },
      { id: 'b', raw: 'Melbourne', state: 'VIC' },
      { id: 'c', raw: 'Vic.', state: 'VIC' },
    ])
    expect(plan.counts).toEqual({ before: 5, nowState: 3, nowGroup: 1, stillUnresolved: 1, after: 2 })
  })

  it('does nothing with nothing to do', () => {
    expect(planRawStateRenormalise([]).counts).toEqual({
      before: 0,
      nowState: 0,
      nowGroup: 0,
      stillUnresolved: 0,
      after: 0,
    })
  })
})

describe('runRawStateRenormalise', () => {
  const updates: Array<{ table: string; columns: unknown; filters: string[] }> = []

  beforeEach(() => {
    updates.length = 0
    const from = (table: string) => {
      const filters: string[] = []
      let columns: unknown = null
      const chain = {
        select: () => chain,
        is: (col: string) => (filters.push(`${col} is null`), chain),
        not: () => chain,
        eq: (col: string, val: string) => (filters.push(`${col}=${val}`), chain),
        update: (cols: unknown) => ((columns = cols), chain),
        then: (resolve: (v: unknown) => void) => {
          if (columns) {
            updates.push({ table, columns, filters })
            return resolve({ data: [{ id: 'x' }], error: null })
          }
          return resolve({
            data: [
              { id: `${table}-1`, meta_state_raw: 'Sydney' },
              { id: `${table}-2`, meta_state_raw: 'Gold Coast' },
            ],
            error: null,
          })
        },
      }
      return chain
    }
    vi.mocked(getSupabaseServerClient).mockReturnValue({ from } as never)
  })

  it('writes nothing on a dry run', async () => {
    const result = await runRawStateRenormalise({ dryRun: true })
    expect(updates).toEqual([])
    expect(result.leads).toEqual({ before: 2, nowState: 1, nowGroup: 0, stillUnresolved: 1, after: 1 })
    expect(result.submissions).toEqual(result.leads)
  })

  it('sets the state, clears the raw text, and guards on the text being unchanged', async () => {
    await runRawStateRenormalise({ dryRun: false })
    expect(updates.map((u) => u.table)).toEqual(['leads', 'lead_submissions'])
    for (const update of updates) {
      expect(update.columns).toEqual({ state: 'NSW', meta_state_raw: null, meta_state_options: null })
      expect(update.filters).toEqual(
        expect.arrayContaining(['meta_state_raw=Sydney', 'state is null', 'meta_state_options is null']),
      )
    }
  })
})
