import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { parseAbnDetails, parseMatchingNames } from '../parse'
import { JsonpParseError } from '../jsonp'

/**
 * Reading ABR responses, against committed fixtures of the real shapes.
 *
 * Offline by construction: no network, and no ABR_GUID needed to run any of it.
 */

function fixture(name: string): string {
  return readFileSync(join(__dirname, 'fixtures', `${name}.txt`), 'utf8')
}

describe('parseMatchingNames', () => {
  it('reads every relevant match off a multi-result response', () => {
    const { matches } = parseMatchingNames(fixture('matching_names_multi'))
    expect(matches).toHaveLength(4)
    expect(matches[0]).toEqual({
      abn: '53004085616',
      entityName: 'WHITLOCK CIVIL PTY LTD',
      abnStatus: '0000000001',
      status: 'active',
      nameType: 'Entity Name',
      state: 'QLD',
      postcode: '4000',
      score: 100,
      isCurrent: true,
    })
  })

  it('reads the coded status MatchingNames answers with', () => {
    // Live responses carry "0000000001"/"0000000002" here, not the words
    // AbnDetails uses. Rendered raw, that put "0000000001" on a badge and read
    // every row as not active.
    const { matches } = parseMatchingNames(fixture('matching_names_multi'))
    expect(matches.map((m) => m.status)).toEqual(['active', 'active', 'cancelled', 'active'])
  })

  it('drops the phonetic tail ABR pads a result set with', () => {
    // "WEDLOCK CIVIC RETREATS" at 87 against a 100 is noise, not a candidate.
    const { matches } = parseMatchingNames(fixture('matching_names_multi'))
    expect(matches.map((m) => m.score)).toEqual([100, 94, 94, 93])
    expect(matches.some((m) => m.entityName.includes('RETREATS'))).toBe(false)
  })

  it('keeps a weak field when there is nothing stronger to compare it to', () => {
    // A genuinely obscure company whose best match only scores 80 still gets
    // its neighbours — the cut is relative, never a fixed floor.
    const body =
      'callback({"Message":"","Names":[{"Abn":"53004085616","Name":"A","Score":80},' +
      '{"Abn":"29127500033","Name":"B","Score":74}]})'
    expect(parseMatchingNames(body).matches).toHaveLength(2)
  })

  it('reads the "Is Current" key, space and all', () => {
    const { matches } = parseMatchingNames(fixture('matching_names_multi'))
    expect(matches.map((m) => m.isCurrent)).toEqual([true, true, false, true])
  })

  it('carries a cancelled ABN through rather than dropping it', () => {
    // Staff need to see it in the list — that is the whole point of showing
    // status on the row.
    const { matches } = parseMatchingNames(fixture('matching_names_multi'))
    const cancelled = matches.find((m) => m.abn === '61604882436')
    expect(cancelled?.status).toBe('cancelled')
  })

  it('keeps the raw ALL CAPS entity name untouched', () => {
    const { matches } = parseMatchingNames(fixture('matching_names_multi'))
    expect(matches[3].entityName).toBe('THE TRUSTEE FOR WHITLOCK FAMILY TRUST')
  })

  it('orders by ABR score, best first', () => {
    const { matches } = parseMatchingNames(fixture('matching_names_multi'))
    expect(matches.map((m) => m.score)).toEqual([100, 94, 94, 93])
  })

  // ---- no matches ----

  it('returns no matches and the register message when nothing is found', () => {
    const result = parseMatchingNames(fixture('matching_names_empty'))
    expect(result.matches).toEqual([])
    expect(result.message).toBe('No matching names found')
  })

  it('treats a missing Names array as no matches, not an error', () => {
    expect(parseMatchingNames('callback({"Message":""})')).toEqual({ message: '', matches: [] })
  })

  it('treats a null Names as no matches', () => {
    expect(parseMatchingNames('callback({"Message":"","Names":null}) ').matches).toEqual([])
  })

  it('skips rows carrying neither an ABN nor a name', () => {
    const body = 'callback({"Message":"","Names":[{"Score":10},{"Abn":"53004085616","Name":"X"}]})'
    expect(parseMatchingNames(body).matches).toHaveLength(1)
  })

  it('throws on a body that is not JSON at all', () => {
    expect(() => parseMatchingNames('<html>down for maintenance</html>')).toThrow(JsonpParseError)
  })
})

describe('parseAbnDetails', () => {
  it('reads an active company', () => {
    const details = parseAbnDetails(fixture('abn_details_company'))
    expect(details).toEqual({
      abn: '53004085616',
      abnStatus: 'Active',
      status: 'active',
      abnStatusEffectiveFrom: '1999-11-01',
      acn: '004085616',
      entityName: 'WHITLOCK  CIVIL PTY LTD',
      entityTypeCode: 'PRV',
      entityTypeName: 'Australian Private Company',
      state: 'QLD',
      postcode: '4000',
    })
  })

  it('reads a trust, which has no ACN of its own', () => {
    const details = parseAbnDetails(fixture('abn_details_trust'))
    expect(details?.acn).toBe('')
    expect(details?.entityTypeCode).toBe('DTT')
    expect(details?.entityName).toBe('THE TRUSTEE FOR SMITH FAMILY TRUST')
  })

  it('reads a cancelled ABN and the date it went', () => {
    const details = parseAbnDetails(fixture('abn_details_cancelled'))
    expect(details?.status).toBe('cancelled')
    expect(details?.abnStatusEffectiveFrom).toBe('2024-03-11')
  })

  it('returns null when the register has no entity for the number', () => {
    expect(parseAbnDetails(fixture('abn_details_unknown'))).toBeNull()
  })

  it('strips whatever spacing the register puts in its own numbers', () => {
    const body = 'callback({"Abn":"53 004 085 616","Acn":"004 085 616"})'
    const details = parseAbnDetails(body)
    expect(details?.abn).toBe('53004085616')
    expect(details?.acn).toBe('004085616')
  })

  it('throws on a body that is not JSON at all', () => {
    expect(() => parseAbnDetails('<html>down for maintenance</html>')).toThrow(JsonpParseError)
  })
})
