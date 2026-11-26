import { describe, expect, it } from 'vitest'
import { lateLodgementRows, lateLodgementsTitle, lateLodgementsTsv } from '../lateLodgementRows'
import type { EnrichedRow } from '../types'

/** The late lodgements under the two top cards (item 10). Synthetic rows only. */

const row = (i: number, type: EnrichedRow['lodgementType'], days: number): EnrichedRow => ({
  rowIndex: i,
  processedDate: new Date('2024-03-15T00:00:00Z'),
  effectiveDate: new Date('2023-10-28T00:00:00Z'),
  rawProcessed: '',
  rawEffective: '',
  description: `Original Activity Statement for the period ending 30 Sep 23`,
  debit: 100,
  credit: null,
  balance: null,
  periodEnding: new Date('2023-09-30T00:00:00Z'),
  lodgementType: type,
  lateLodgementDays: days,
  lateLodgeDaysCleaned: days,
})

describe('late lodgements list', () => {
  it('period, lodged, due, days late, original or amended; Australian dates', () => {
    const [r] = lateLodgementRows([row(1, 'Original', 139)])
    expect(r).toMatchObject({ period: '30/09/2023', lodged: '15/03/2024', due: '28/10/2023', daysLate: 139, kind: 'Original' })
  })

  it('the dropdown says how many, original and amended', () => {
    const rows = lateLodgementRows([row(1, 'Original', 5), row(2, 'Original', 3), row(3, 'ClientAmended', 9)])
    expect(lateLodgementsTitle(rows, false)).toBe('Show the 3 late lodgements (2 original, 1 amended)')
    expect(lateLodgementsTitle(rows, true)).toBe('Hide the 3 late lodgements (2 original, 1 amended)')
    expect(lateLodgementsTitle(rows.slice(0, 1), false)).toBe('Show the 1 late lodgement')
  })

  it('Copy all is tab-separated with the headings', () => {
    const text = lateLodgementsTsv(lateLodgementRows([row(1, 'Original', 139)]))
    expect(text.split('\n')[0]).toBe('Period\tLodged\tDue\tDays late\tOriginal / amended\tDescription as printed')
    expect(text.split('\n')[1].startsWith('30/09/2023\t15/03/2024\t28/10/2023\t139\tOriginal\t')).toBe(true)
  })
})
