import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { mapAsicapiCompany, mapAsicapiExtract, mapDirectors, redactAsicapiExtract } from '../map'
import { AsicResponseError } from '../errors'

/**
 * asicapi JSON -> summary and stored raw.
 *
 * Synthetic fixtures only — see fixtures/README.md. Every case here is one
 * where a wrong answer ends up on an insolvency file: a ceased director shown
 * as current, a secretary counted twice, a shareholder's home address stored.
 */

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(join(__dirname, 'fixtures', `${name}.json`), 'utf8'))
}

const TWO_DIRECTORS = () => mapAsicapiExtract(fixture('extract_two_directors'), '000000019')
const EDGE_CASES = () => mapAsicapiExtract(fixture('extract_edge_cases'), '000000028')

/** A minimal officeholder, for the cases that need one row to say one thing. */
function holder(
  name: string,
  birthDate: string | null,
  role = 'DR',
  status: string | null = 'C',
): Record<string, unknown> {
  return {
    role: { code: role, label: role },
    status: status === null ? null : { code: status, label: status },
    ceasedAt: null,
    party: {
      type: 'person',
      person: { formatted: name },
      birth: birthDate ? { date: birthDate } : null,
    },
  }
}

describe('mapAsicapiExtract — directors', () => {
  it('keeps both current directors, in ASIC order, with their dates of birth', () => {
    expect(TWO_DIRECTORS().summary.directors).toEqual([
      { name: 'Jane Mary Sample', dateOfBirth: '1970-05-01' },
      { name: 'John Example', dateOfBirth: '1982-11' },
    ])
  })

  it('shows a person who is both director and secretary once', () => {
    const names = TWO_DIRECTORS().summary.directors.map((d) => d.name)
    expect(names.filter((name) => name === 'Jane Mary Sample')).toHaveLength(1)
  })

  it('leaves out a ceased director', () => {
    const names = TWO_DIRECTORS().summary.directors.map((d) => d.name)
    expect(names).not.toContain('Pat Former')
  })

  it('leaves out a director marked ceased by date alone', () => {
    const ceased = { ...holder('PAT FORMER', null), ceasedAt: '2021-06-30' }
    expect(mapDirectors([ceased])).toEqual([])
  })

  it('allows a missing date of birth, building the name from its parts', () => {
    // formatted is null on this one, so the name comes from givenNames + familyName.
    expect(EDGE_CASES().summary.directors).toContainEqual({
      name: 'Alex Placeholder',
      dateOfBirth: null,
    })
  })

  it('keeps a month/year date of birth at month precision', () => {
    const john = TWO_DIRECTORS().summary.directors.find((d) => d.name === 'John Example')
    expect(john?.dateOfBirth).toBe('1982-11')
  })

  it('keeps a year-only date of birth at year precision', () => {
    const sam = EDGE_CASES().summary.directors.find((d) => d.name === 'Sam Example')
    expect(sam?.dateOfBirth).toBe('1990')
  })

  it('drops a date of birth that is not a real date rather than showing it', () => {
    expect(mapDirectors([holder('JANE SAMPLE', '1970-02-30')])).toEqual([
      { name: 'Jane Sample', dateOfBirth: null },
    ])
  })

  it('ignores an unknown role and an unknown status (label === code)', () => {
    const names = EDGE_CASES().summary.directors.map((d) => d.name)
    expect(names).not.toContain('Unknown Role')
    expect(names).not.toContain('Unknown Status')
    expect(names).toEqual(['Alex Placeholder', 'Sam Example'])
  })

  it('reads a missing status as current rather than losing the director', () => {
    expect(mapDirectors([holder('JANE SAMPLE', null, 'DR', null)])).toHaveLength(1)
  })

  it('skips an officeholder that is an organisation, not a person', () => {
    const organisation = {
      role: { code: 'DR', label: 'Director' },
      status: { code: 'C', label: 'Current' },
      party: { type: 'organisation', person: null, birth: null, organisation: { name: 'X PTY LTD' } },
    }
    expect(mapDirectors([organisation])).toEqual([])
  })

  it('keeps two different people who share a name', () => {
    // A father and son on the same board are two directors, not one.
    expect(
      mapDirectors([holder('JOHN EXAMPLE', '1950-01-01'), holder('JOHN EXAMPLE', '1980-01-01')]),
    ).toHaveLength(2)
  })

  it('folds an undated duplicate into the dated one, whichever comes first', () => {
    const dated = { name: 'Jane Sample', dateOfBirth: '1970-05-01' }
    expect(mapDirectors([holder('JANE SAMPLE', null), holder('JANE SAMPLE', '1970-05-01')])).toEqual([
      dated,
    ])
    expect(mapDirectors([holder('JANE SAMPLE', '1970-05-01'), holder('Jane  Sample', null)])).toEqual([
      dated,
    ])
  })

  it('answers an empty list for a missing or malformed section', () => {
    expect(mapDirectors(undefined)).toEqual([])
    expect(mapDirectors({ data: 'nope' })).toEqual([])
    expect(mapDirectors([null, 'x', 3])).toEqual([])
  })
})

describe('mapAsicapiExtract — addresses', () => {
  it('uses the current registered office, not a ceased one', () => {
    expect(TWO_DIRECTORS().summary.registeredOffice).toBe(
      'C/- Example Accountants, Level 2, 1 Sample Street, North Melbourne VIC 3051',
    )
  })

  it('uses the principal place of business, not the ASIC contact address', () => {
    expect(TWO_DIRECTORS().summary.principalPlaceOfBusiness).toBe(
      'Unit 4, 20 Example Road, Richmond VIC 3121',
    )
  })

  it('keeps both when the registered office is the principal place of business', () => {
    const { registeredOffice, principalPlaceOfBusiness } = EDGE_CASES().summary
    expect(registeredOffice).toBe('5 Placeholder Lane, Sampleville NSW 2000')
    expect(principalPlaceOfBusiness).toBe(registeredOffice)
  })

  it('ignores an address type it does not know (label === code)', () => {
    const { registeredOffice, principalPlaceOfBusiness } = EDGE_CASES().summary
    expect(registeredOffice).not.toContain('Unknown Type')
    expect(principalPlaceOfBusiness).not.toContain('Unknown Type')
  })

  it('finds the principal place of business by label if its code changes', () => {
    const { summary } = mapAsicapiExtract(
      {
        acn: '000000019',
        addresses: [
          {
            type: { code: 'PP', label: 'Principal Place Of Business address' },
            status: { code: 'C', label: 'Current' },
            address: { street: '20 EXAMPLE ROAD', locality: 'RICHMOND', state: 'VIC', postcode: '3121' },
          },
        ],
      },
      '000000019',
    )
    expect(summary.principalPlaceOfBusiness).toBe('20 Example Road, Richmond VIC 3121')
  })

  it('formats an address with parts missing from what is there', () => {
    const { summary } = mapAsicapiExtract(
      {
        acn: '000000019',
        addresses: [
          {
            type: { code: 'RG', label: 'Registered Office' },
            status: { code: 'C', label: 'Current' },
            address: { careOf: null, street: null, locality: 'SAMPLEVILLE', state: 'NSW', postcode: null },
          },
        ],
      },
      '000000019',
    )
    expect(summary.registeredOffice).toBe('Sampleville NSW')
  })

  it('answers null, not an empty string, when there is no address', () => {
    const { summary } = mapAsicapiExtract(
      {
        acn: '000000019',
        addresses: [
          { type: { code: 'RG', label: 'Registered Office' }, status: { code: 'C' }, address: {} },
        ],
      },
      '000000019',
    )
    expect(summary.registeredOffice).toBeNull()
    expect(summary.principalPlaceOfBusiness).toBeNull()
  })

  it('falls back to the Australian registered office of a foreign company', () => {
    const { summary } = mapAsicapiExtract(
      {
        acn: '000000019',
        addresses: [
          {
            type: { code: 'RP', label: 'Registered Office in Australia' },
            status: { code: 'C' },
            address: { street: '1 SAMPLE STREET', locality: 'SYDNEY', state: 'NSW', postcode: '2000' },
          },
        ],
      },
      '000000019',
    )
    expect(summary.registeredOffice).toBe('1 Sample Street, Sydney NSW 2000')
  })
})

describe('mapAsicapiExtract — identity and reference', () => {
  it('reads identity from a nested company object', () => {
    const { summary, providerExtractId, asOf } = TWO_DIRECTORS()
    expect(summary).toMatchObject({
      acn: '000000019',
      abn: '89000000019',
      companyName: 'Sample Trading Pty Ltd',
      companyStatus: { code: 'REGD', label: 'Registered' },
      asOf: '2026-09-04T03:12:41Z',
    })
    expect(providerExtractId).toBe('ext_TEST0000000001')
    expect(asOf).toBe('2026-09-04T03:12:41Z')
  })

  it('reads identity and reference from the top level when there is no nesting', () => {
    const { summary, providerExtractId, asOf } = EDGE_CASES()
    expect(summary.companyName).toBe('Example Holdings Pty Ltd')
    expect(summary.abn).toBe('91000000028')
    expect(providerExtractId).toBe('ext_TEST0000000002')
    expect(asOf).toBe('2026-09-05T01:00:00Z')
  })

  it('refuses an extract for a different ACN than the one asked for', () => {
    // Attaching it would put another company's directors on this file.
    expect(() => mapAsicapiExtract(fixture('extract_two_directors'), '000000028')).toThrow(
      AsicResponseError,
    )
  })

  it('refuses a response that is not an object', () => {
    expect(() => mapAsicapiExtract(null, '000000019')).toThrow(AsicResponseError)
    expect(() => mapAsicapiExtract([], '000000019')).toThrow(AsicResponseError)
  })

  it('leaves the ABN blank rather than storing a malformed one', () => {
    const { summary } = mapAsicapiExtract({ acn: '000000019', abn: '123' }, '000000019')
    expect(summary.abn).toBe('')
  })

  it('keeps the ACN it was asked for when the response does not repeat it', () => {
    expect(mapAsicapiExtract({}, '000 000 019').summary.acn).toBe('000000019')
  })
})

describe('redactAsicapiExtract — what gets stored', () => {
  const raw = () => TWO_DIRECTORS().raw as Record<string, unknown>
  const text = () => JSON.stringify(raw())

  it('removes members and shareholders entirely', () => {
    expect(raw()).not.toHaveProperty('members')
    expect(text()).not.toContain('beneficiallyHeld')
  })

  it('removes every officeholder address', () => {
    // The director's residential address is in the fixture; it must not survive.
    expect(text()).not.toContain('PRIVATE HOME STREET')
    expect(text()).not.toContain('KEW')
  })

  it('keeps only the date of birth, and only for directors', () => {
    expect(text()).not.toContain('SAMPLEVILLE')
    expect(text()).not.toContain('EXAMPLETOWN')

    const holders = raw().officeholders as Array<{ role: { code: string }; party: { birth: unknown } }>
    for (const entry of holders) {
      if (entry.role.code === 'DR') expect(entry.party.birth).toEqual({ date: expect.any(String) })
      else expect(entry.party.birth).toBeNull()
    }
  })

  it('keeps what is useful for audit', () => {
    expect(raw()).toHaveProperty('shareCapital')
    expect(raw()).toHaveProperty('meta')
    expect(raw()).toHaveProperty('extract')
    expect((raw().officeholders as unknown[]).length).toBe(4)
  })

  it('redacts list-shaped officeholder sections too', () => {
    const redacted = redactAsicapiExtract({
      officeholders: { object: 'list', data: [holder('JANE SAMPLE', '1970-05-01', 'SR')] },
      members: { object: 'list', data: [{ name: 'JANE SAMPLE' }] },
    }) as { officeholders: { data: Array<{ party: { birth: unknown } }> } }
    expect(redacted).not.toHaveProperty('members')
    expect(redacted.officeholders.data[0].party.birth).toBeNull()
  })

  it('does not mutate what it was given', () => {
    const input = fixture('extract_two_directors') as Record<string, unknown>
    redactAsicapiExtract(input)
    expect(input).toHaveProperty('members')
  })
})

describe('mapAsicapiCompany', () => {
  it('maps the free lookup', () => {
    expect(mapAsicapiCompany(fixture('company_lookup'))).toEqual({
      acn: '000000019',
      abn: '89000000019',
      name: 'Sample Trading Pty Ltd',
      status: { code: 'REGD', label: 'Registered' },
      type: { code: 'APTY', label: 'Australian Proprietary Company' },
    })
  })

  it('answers null without a usable ACN or name', () => {
    expect(mapAsicapiCompany({ acn: '123', name: 'X PTY LTD' })).toBeNull()
    expect(mapAsicapiCompany({ acn: '000000019', name: '' })).toBeNull()
    expect(mapAsicapiCompany('nope')).toBeNull()
  })

  it('shows an unknown status code as its code', () => {
    const company = mapAsicapiCompany({ acn: '000000019', name: 'X', status: { code: 'ZZZ' } })
    expect(company?.status).toEqual({ code: 'ZZZ', label: 'ZZZ' })
  })
})
