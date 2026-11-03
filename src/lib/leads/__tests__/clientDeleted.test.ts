import { describe, it, expect } from 'vitest'
import { conversionBody, deletedNote, stageBeforeConversion } from '../clientDeleted'

/** A lead whose client file is deleted goes back to its stage before conversion. Synthetic data only. */

const entry = (body: string, created_at: string) => ({ type: 'stage_change', body, created_at })

describe('stageBeforeConversion', () => {
  it('reads the stage recorded on the latest conversion', () => {
    const activities = [
      entry(conversionBody('lead'), '2026-09-01T00:00:00Z'),
      entry('Stage changed from Client to Lead.', '2026-09-02T00:00:00Z'),
      entry(conversionBody('prospect'), '2026-10-01T00:00:00Z'),
    ]
    expect(stageBeforeConversion(activities)).toBe('prospect')
  })

  it('falls back to Lead when the conversion did not record it, or recorded Client', () => {
    expect(stageBeforeConversion([entry(conversionBody(null), '2026-10-21T01:08:00Z')])).toBe('lead')
    expect(stageBeforeConversion([entry(conversionBody('client'), '2026-10-21T01:08:00Z')])).toBe('lead')
    expect(stageBeforeConversion([])).toBe('lead')
  })

  it('still reads entries written before two stages were renamed (migration 0042)', () => {
    const CONVERTED = 'Converted to a client file in the restructuring workspace.'
    expect(stageBeforeConversion([entry(`${CONVERTED} Stage before: Non-proceeding.`, '2026-10-21T01:08:00Z')])).toBe('non_proceeding')
    expect(stageBeforeConversion([entry(`${CONVERTED} Stage before: Do not contact.`, '2026-10-21T01:08:00Z')])).toBe('do_not_contact')
    expect(stageBeforeConversion([entry(conversionBody('non_proceeding'), '2026-11-04T01:08:00Z')])).toBe('non_proceeding')
  })

  it('reads a stage staff added by its name, unless it has since been hidden', () => {
    const waiting = { key: 'custom_aaaa1111' as const, label: 'Waiting', position: 1, hiddenAt: null }
    const activities = [entry(conversionBody('custom_aaaa1111', [waiting]), '2026-11-04T01:08:00Z')]
    expect(activities[0].body).toContain('Stage before: Waiting.')
    expect(stageBeforeConversion(activities, [waiting])).toBe('custom_aaaa1111')
    // Set back into a stage with no tab, the lead would be on no tab at all.
    expect(stageBeforeConversion(activities, [{ ...waiting, hiddenAt: '2026-11-05T00:00:00Z' }])).toBe('lead')
  })
})

describe('deletedNote', () => {
  it('says when, by whom, and the stage set back to', () => {
    expect(deletedNote(new Date('2026-10-24T03:00:00Z'), 'Gabby', 'prospect')).toBe('Client file deleted on 24 Oct 2026 by Gabby. Stage set back to Prospect.')
  })
})
