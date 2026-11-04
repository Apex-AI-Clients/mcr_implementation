import { describe, expect, it } from 'vitest'
import { choiceValue, choiceValues } from '../choice'

/** A choice field's ticked boxes, stored as plain text. */

const ORDER = ['receiver_manager', 'court_liquidator', 'cvl_liquidator']

describe('choice values', () => {
  it('reads one box or several, each once; blank is none', () => {
    expect(choiceValues('cvl_liquidator')).toEqual(['cvl_liquidator'])
    expect(choiceValues('cvl_liquidator, court_liquidator,cvl_liquidator')).toEqual(['cvl_liquidator', 'court_liquidator'])
    expect(choiceValues(null)).toEqual([])
    expect(choiceValues('')).toEqual([])
    expect(choiceValues(true)).toEqual([])
  })

  it('stores the boxes in the form’s order, and none as blank', () => {
    expect(choiceValue(['cvl_liquidator', 'receiver_manager'], ORDER)).toBe('receiver_manager,cvl_liquidator')
    expect(choiceValue(['cvl_liquidator'], ORDER)).toBe('cvl_liquidator')
    expect(choiceValue([], ORDER)).toBeNull()
    // Something not on the form is dropped.
    expect(choiceValue(['trustee'], ORDER)).toBeNull()
  })
})
