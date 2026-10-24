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
})

describe('deletedNote', () => {
  it('says when, by whom, and the stage set back to', () => {
    expect(deletedNote(new Date('2026-10-24T03:00:00Z'), 'Gabby', 'prospect')).toBe('Client file deleted on 24 Oct 2026 by Gabby. Stage set back to Prospect.')
  })
})
