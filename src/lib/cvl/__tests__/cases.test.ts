import { describe, expect, it } from 'vitest'
import { readCvlStatus, statusUpdate } from '../cases'

/** Draft → Forms prepared → Printed, with dates (migration 0039's cvl_cases_status_dates). */

const AT = new Date('2026-10-28T03:00:00.000Z')
const EARLIER = '2026-10-20T01:00:00.000Z'

describe('statusUpdate', () => {
  it('stamps each step forward with its date', () => {
    expect(statusUpdate({ status: 'draft', formsPreparedAt: null, printedAt: null }, 'forms_prepared', AT)).toEqual({
      status: 'forms_prepared',
      forms_prepared_at: AT.toISOString(),
      printed_at: null,
    })
    expect(statusUpdate({ status: 'forms_prepared', formsPreparedAt: EARLIER, printedAt: null }, 'printed', AT)).toEqual({
      status: 'printed',
      forms_prepared_at: EARLIER,
      printed_at: AT.toISOString(),
    })
  })

  it('stamps both dates when going straight from Draft to Printed', () => {
    expect(statusUpdate({ status: 'draft', formsPreparedAt: null, printedAt: null }, 'printed', AT)).toEqual({
      status: 'printed',
      forms_prepared_at: AT.toISOString(),
      printed_at: AT.toISOString(),
    })
  })

  it('clears the later dates on a step back, and keeps the earlier one', () => {
    expect(statusUpdate({ status: 'printed', formsPreparedAt: EARLIER, printedAt: EARLIER }, 'forms_prepared', AT)).toEqual({
      status: 'forms_prepared',
      forms_prepared_at: EARLIER,
      printed_at: null,
    })
    expect(statusUpdate({ status: 'printed', formsPreparedAt: EARLIER, printedAt: EARLIER }, 'draft', AT)).toEqual({
      status: 'draft',
      forms_prepared_at: null,
      printed_at: null,
    })
  })

  it('changes nothing when the status is already the one asked for', () => {
    expect(statusUpdate({ status: 'printed', formsPreparedAt: EARLIER, printedAt: EARLIER }, 'printed', AT)).toBeNull()
  })
})

describe('readCvlStatus', () => {
  it('reads an unknown stored status as Draft rather than claim progress', () => {
    expect(readCvlStatus('printed')).toBe('printed')
    expect(readCvlStatus('done')).toBe('draft')
    expect(readCvlStatus(null)).toBe('draft')
  })
})
