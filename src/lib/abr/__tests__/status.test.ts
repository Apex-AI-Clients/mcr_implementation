import { describe, it, expect } from 'vitest'
import { abnStatusLabel, normaliseAbnStatus } from '../types'

/**
 * Reading what the register meant by a status.
 *
 * The two endpoints answer differently — AbnDetails in words, MatchingNames in
 * a padded numeric code — and the first live response made that obvious by
 * putting "0000000001" on a badge and reading every row as not active.
 *
 * The rule worth pinning is the third answer: anything unrecognised is
 * 'unknown', never a guess. A wrong "Cancelled" on an insolvency file is worse
 * than no badge at all.
 */

describe('normaliseAbnStatus', () => {
  it('reads the words AbnDetails uses', () => {
    expect(normaliseAbnStatus('Active')).toBe('active')
    expect(normaliseAbnStatus('Cancelled')).toBe('cancelled')
  })

  it('is case- and whitespace-insensitive about them', () => {
    expect(normaliseAbnStatus('  ACTIVE ')).toBe('active')
    expect(normaliseAbnStatus('cancelled')).toBe('cancelled')
  })

  it('accepts the American spelling, in case the register ever uses it', () => {
    expect(normaliseAbnStatus('Canceled')).toBe('cancelled')
  })

  it('reads the padded codes MatchingNames answers with', () => {
    expect(normaliseAbnStatus('0000000001')).toBe('active')
    expect(normaliseAbnStatus('0000000002')).toBe('cancelled')
  })

  it('reads the same codes unpadded', () => {
    expect(normaliseAbnStatus('1')).toBe('active')
    expect(normaliseAbnStatus('2')).toBe('cancelled')
  })

  it('claims nothing about a code it does not recognise', () => {
    expect(normaliseAbnStatus('0000000009')).toBe('unknown')
    expect(normaliseAbnStatus('Suspended')).toBe('unknown')
  })

  it('claims nothing about a missing status', () => {
    expect(normaliseAbnStatus('')).toBe('unknown')
    expect(normaliseAbnStatus('   ')).toBe('unknown')
  })
})

describe('abnStatusLabel', () => {
  it('spells out the two it knows', () => {
    expect(abnStatusLabel('active')).toBe('Active')
    expect(abnStatusLabel('cancelled')).toBe('Cancelled')
  })

  it('says nothing for unknown, so nothing gets rendered', () => {
    expect(abnStatusLabel('unknown')).toBe('')
  })
})
