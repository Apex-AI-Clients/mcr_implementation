import { afterEach, describe, it, expect, vi } from 'vitest'
import {
  acnToLookUp,
  describeAcnAbnOutcome,
  interpretAcnLookups,
  lookupAbnForAcn,
  type CandidateLookup,
} from '../acnAbn'
import { lookupAbn, type AbrDetailsResult } from '../browser'
import type { AbrEntityDetails } from '../types'

// Synthetic: ACN 123 456 780, whose only candidate ABN is 11 123 456 780.
// ACN 100 000 682 has two candidates, 10… and 99…. Nobody real.
const ACN = '123456780'
const ABN = '11123456780'

function entity(overrides: Partial<AbrEntityDetails> = {}): AbrEntityDetails {
  return {
    abn: ABN,
    abnStatus: 'Active',
    status: 'active',
    abnStatusEffectiveFrom: '2015-01-12',
    acn: ACN,
    entityName: 'SAMPLE TRADING PTY LTD',
    entityTypeCode: 'PRV',
    entityTypeName: 'Australian Private Company',
    state: 'VIC',
    postcode: '3000',
    ...overrides,
  }
}

const ok = (details: AbrEntityDetails): AbrDetailsResult => ({ kind: 'ok', details })
const notFound: AbrDetailsResult = { kind: 'failed', message: 'No entity.', notFound: true }
const down: AbrDetailsResult = { kind: 'failed', message: "Couldn't reach the lookup service." }

describe('acnToLookUp', () => {
  const state = { companyManual: false, acnNumber: '123 456 780', abnNumber: '' }

  it('answers the ACN to check, as digits', () => {
    expect(acnToLookUp(state, new Set())).toBe(ACN)
  })

  it('never runs with the company’s "Enter manually" ticked', () => {
    expect(acnToLookUp({ ...state, companyManual: true }, new Set())).toBeNull()
  })

  it('only once per ACN', () => {
    expect(acnToLookUp(state, new Set([ACN]))).toBeNull()
  })

  it('only while the company ABN is empty', () => {
    expect(acnToLookUp({ ...state, abnNumber: ABN }, new Set())).toBeNull()
  })

  it('only for a valid ACN', () => {
    expect(acnToLookUp({ ...state, acnNumber: '1234' }, new Set())).toBeNull()
    expect(acnToLookUp({ ...state, acnNumber: '123456789' }, new Set())).toBeNull()
  })
})

describe('interpretAcnLookups', () => {
  it('found: an active ABN whose record carries this ACN', () => {
    expect(interpretAcnLookups(ACN, [{ abn: ABN, result: ok(entity()) }])).toEqual({
      kind: 'found',
      abn: ABN,
    })
  })

  it('treats an unrecognised status as found, not cancelled', () => {
    const lookups = [{ abn: ABN, result: ok(entity({ status: 'unknown', abnStatus: '' })) }]
    expect(interpretAcnLookups(ACN, lookups).kind).toBe('found')
  })

  it('ignores a record that carries a different ACN', () => {
    const lookups = [{ abn: ABN, result: ok(entity({ acn: '000000019' })) }]
    expect(interpretAcnLookups(ACN, lookups)).toEqual({ kind: 'none' })
  })

  it('cancelled is not "none": it carries the ABN and the date', () => {
    const lookups = [
      {
        abn: ABN,
        result: ok(
          entity({ status: 'cancelled', abnStatus: 'Cancelled', abnStatusEffectiveFrom: '2024-03-11' }),
        ),
      },
    ]
    expect(interpretAcnLookups(ACN, lookups)).toEqual({
      kind: 'cancelled',
      abn: ABN,
      cancelledOn: '2024-03-11',
    })
  })

  it('prefers a live candidate over a cancelled one', () => {
    const lookups: CandidateLookup[] = [
      { abn: '10100000682', result: ok(entity({ abn: '10100000682', acn: '100000682', status: 'cancelled' })) },
      { abn: '99100000682', result: ok(entity({ abn: '99100000682', acn: '100000682' })) },
    ]
    expect(interpretAcnLookups('100000682', lookups)).toEqual({ kind: 'found', abn: '99100000682' })
  })

  it('none: the register has no such ABN', () => {
    expect(interpretAcnLookups(ACN, [{ abn: ABN, result: notFound }])).toEqual({ kind: 'none' })
  })

  it('none for no candidates at all', () => {
    expect(interpretAcnLookups(ACN, [])).toEqual({ kind: 'none' })
  })

  it('unavailable, not "none", when a lookup failed and nothing was found', () => {
    expect(interpretAcnLookups(ACN, [{ abn: ABN, result: down }])).toEqual({
      kind: 'unavailable',
      message: "Couldn't reach the lookup service.",
    })
  })

  it('a find still wins over another candidate’s failure', () => {
    const lookups: CandidateLookup[] = [
      { abn: '10100000682', result: down },
      { abn: '99100000682', result: ok(entity({ abn: '99100000682', acn: '100000682' })) },
    ]
    expect(interpretAcnLookups('100000682', lookups).kind).toBe('found')
  })
})

describe('lookupAbnForAcn', () => {
  it('asks only for the candidate ABNs worked out from the ACN', async () => {
    const lookup = vi.fn(async () => ok(entity()))
    expect(await lookupAbnForAcn('123 456 780', lookup)).toEqual({ kind: 'found', abn: ABN })
    expect(lookup).toHaveBeenCalledTimes(1)
    expect(lookup).toHaveBeenCalledWith(ABN)
  })

  it('asks for both candidates when there are two', async () => {
    const lookup = vi.fn<(abn: string) => Promise<AbrDetailsResult>>(async () => notFound)
    expect(await lookupAbnForAcn('100000682', lookup)).toEqual({ kind: 'none' })
    expect(lookup.mock.calls.map(([abn]) => abn)).toEqual(['10100000682', '99100000682'])
  })

  it('asks nothing for an invalid ACN', async () => {
    const lookup = vi.fn(async () => notFound)
    expect(await lookupAbnForAcn('123456789', lookup)).toEqual({ kind: 'none' })
    expect(lookup).not.toHaveBeenCalled()
  })
})

describe('lookupAbn — a 404 is an answer', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('marks a 404 as notFound', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'No entity.' }), { status: 404 })),
    )
    expect(await lookupAbn(ABN)).toEqual({ kind: 'failed', message: 'No entity.', notFound: true })
  })

  it('does not mark any other failure as notFound', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'Too many.' }), { status: 429 })),
    )
    expect(await lookupAbn(ABN)).toEqual({ kind: 'failed', message: 'Too many.' })
  })
})

describe('describeAcnAbnOutcome', () => {
  it('words each outcome', () => {
    expect(describeAcnAbnOutcome({ kind: 'found', abn: ABN })).toBe('Use ABN 11 123 456 780')
    expect(
      describeAcnAbnOutcome({ kind: 'cancelled', abn: ABN, cancelledOn: '2024-03-11' }),
    ).toBe('ABN 11 123 456 780 was cancelled on 11 March 2024')
    expect(describeAcnAbnOutcome({ kind: 'cancelled', abn: ABN, cancelledOn: '' })).toBe(
      'ABN 11 123 456 780 was cancelled',
    )
    expect(describeAcnAbnOutcome({ kind: 'none' })).toBe(
      'No ABN registered for this ACN (normal for trustee companies)',
    )
    expect(describeAcnAbnOutcome({ kind: 'unavailable', message: 'x' })).toBe('')
  })
})
