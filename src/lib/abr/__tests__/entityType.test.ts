import { describe, it, expect } from 'vitest'
import { entityTypeFromAbr, entityTypeFromCode, entityTypeFromName } from '../entityType'

/**
 * ABR entity type -> the two options the conversion form has.
 *
 * The thing worth pinning is the null: a wrong entity type silently changes
 * which fields conversion demands, so anything the register does not settle
 * has to leave the form's own answer standing.
 */

describe('entityTypeFromCode', () => {
  it.each(['PRV', 'PUB', 'CGC', 'SGC'])('maps %s to company', (code) => {
    expect(entityTypeFromCode(code)).toBe('company')
  })

  it.each(['DTT', 'DIT', 'DST', 'FXT', 'FUT', 'HYT', 'PUT', 'PQT', 'CUT'])(
    'maps %s to trust',
    (code) => {
      expect(entityTypeFromCode(code)).toBe('trust')
    },
  )

  it('is case- and whitespace-insensitive', () => {
    expect(entityTypeFromCode(' prv ')).toBe('company')
  })

  it('returns null for an individual', () => {
    expect(entityTypeFromCode('IND')).toBeNull()
  })

  it('returns null for a partnership', () => {
    expect(entityTypeFromCode('FPT')).toBeNull()
  })

  it('leaves superannuation funds unresolved rather than guessing', () => {
    // A trust in law, but not the kind this intake means, and SBR does not
    // reach it — so it belongs in front of a person.
    expect(entityTypeFromCode('SMF')).toBeNull()
    expect(entityTypeFromCode('ARF')).toBeNull()
  })

  it('returns null for an empty or unknown code', () => {
    expect(entityTypeFromCode('')).toBeNull()
    expect(entityTypeFromCode('ZZZ')).toBeNull()
  })
})

describe('entityTypeFromName', () => {
  it('reads the spelled-out type', () => {
    expect(entityTypeFromName('Australian Private Company')).toBe('company')
    expect(entityTypeFromName('Discretionary Investment Trust')).toBe('trust')
  })

  it('prefers trust when a name carries both words', () => {
    expect(entityTypeFromName('Corporate Unit Trust')).toBe('trust')
  })

  it('returns null when the name says neither', () => {
    expect(entityTypeFromName('Individual/Sole Trader')).toBeNull()
    expect(entityTypeFromName('')).toBeNull()
  })
})

describe('entityTypeFromAbr', () => {
  it('takes the code when there is one', () => {
    expect(entityTypeFromAbr('PRV', 'Australian Private Company')).toBe('company')
  })

  it('falls back to the name for a code the map does not carry', () => {
    expect(entityTypeFromAbr('ZZZ', 'Public Trading Trust')).toBe('trust')
  })

  it('returns null when neither settles it', () => {
    expect(entityTypeFromAbr('IND', 'Individual/Sole Trader')).toBeNull()
    expect(entityTypeFromAbr('', '')).toBeNull()
  })
})
