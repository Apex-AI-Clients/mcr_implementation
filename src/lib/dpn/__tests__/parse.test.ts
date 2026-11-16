import { describe, it, expect } from 'vitest'
import { parseDirectorPenaltyNotice, parseMoney, parseNoticeDate } from '../parse'
import {
  EXPECTED_TOTALS,
  PAGE3_ROWS,
  PAGE4_ROWS,
  SYNTHETIC,
  THREE_COLUMN_ROWS,
  THREE_COLUMN_TOTALS,
  noticeLines,
} from './fixtures/notice'
import type { PdfLine } from '@/lib/pdf/pageLines'

/**
 * The DPN parser on SYNTHETIC positioned lines that mirror the ATO layout.
 * No real notice, name or figure is used anywhere.
 */

function parsed(lines: PdfLine[][] = noticeLines()) {
  const result = parseDirectorPenaltyNotice(lines)
  if (result.kind !== 'parsed') throw new Error(`expected parsed, got ${JSON.stringify(result)}`)
  return result.notice
}

describe('parseDirectorPenaltyNotice — fields', () => {
  it('reads every field from its own cell', () => {
    const notice = parsed()
    expect(notice.reference).toBe(SYNTHETIC.reference)
    expect(notice.issuedOn).toBe('2026-09-30')
    expect(notice.type).toBe('paygw')
    expect(notice.companyName).toBe(SYNTHETIC.company)
    expect(notice.acn).toBe(SYNTHETIC.acn)
  })

  it('keeps "Our reference" apart from the name printed on the same line', () => {
    // Page 1's mailing block shares the baseline: the line reads
    // "MR JANE Q SAMPLE Our reference: 1234567890123".
    expect(parsed().reference).toBe(SYNTHETIC.reference)
  })

  it('takes the director from the TO: line and never the address under it', () => {
    const result = parseDirectorPenaltyNotice(noticeLines())
    expect(result.kind).toBe('parsed')
    if (result.kind !== 'parsed') return
    expect(result.notice.directorName).toBe(SYNTHETIC.director)
    const everything = JSON.stringify(result)
    expect(everything).not.toContain('EXAMPLE STREET')
    expect(everything).not.toContain('SAMPLETON')
  })

  it('reads GST from "This notice is for"', () => {
    expect(parsed(noticeLines({ noticeFor: 'GST' })).type).toBe('gst')
  })

  it('falls back to the page-3 subtitle for the type', () => {
    const lines = noticeLines({
      noticeFor: 'amounts listed below',
      subtitle: 'Assessed net goods and services tax amounts',
    })
    expect(parsed(lines).type).toBe('gst')
  })

  it('says it is not a DPN when the wording is nowhere', () => {
    const invoice: PdfLine[][] = [[{ text: 'Tax invoice', cells: [{ x: 50, right: 100, text: 'Tax invoice' }] }]]
    expect(parseDirectorPenaltyNotice(invoice)).toEqual({ kind: 'not_a_dpn' })
  })
})

describe('parseDirectorPenaltyNotice — table', () => {
  it('reads every row across both pages, skipping the repeated header', () => {
    const notice = parsed()
    expect(notice.rows).toHaveLength(PAGE3_ROWS.length + PAGE4_ROWS.length)
    expect(notice.rows[0]).toEqual({
      periodFrom: '2025-01-01',
      periodTo: '2025-03-31',
      column2: 1_250_000,
      column3: 1_000_000,
      column4: 900_000,
      column5: 100_000,
    })
    expect(notice.rows[3].periodFrom).toBe('2024-04-01')
  })

  it('places a wide figure by its right edge, not its left', () => {
    // 123,456.78 starts left of the Column 2 header but ends inside it.
    expect(parsed().rows[2].column2).toBe(12_345_678)
  })

  it('totals each column, since the notice prints no total row', () => {
    expect(parsed().totals).toEqual(EXPECTED_TOTALS)
  })

  it('asks for manual entry when a row has a blank cell', () => {
    const lines = noticeLines()
    const row = lines[2].find((line) => line.text.startsWith('01 JAN 2025'))!
    row.cells.splice(3, 1)
    const result = parseDirectorPenaltyNotice(lines)
    expect(result.kind).toBe('needs_manual')
    if (result.kind === 'needs_manual') expect(result.reason).toBe('table_unreadable')
  })

  it('asks for manual entry when there is no table', () => {
    const result = parseDirectorPenaltyNotice(noticeLines({ page3Rows: [], page4Rows: [] }))
    expect(result).toMatchObject({ kind: 'needs_manual', reason: 'table_unreadable' })
  })
})

describe('parseDirectorPenaltyNotice — manual entry', () => {
  it('sends a super guarantee charge notice to manual entry, prefilled', () => {
    const result = parseDirectorPenaltyNotice(
      noticeLines({ noticeFor: 'superannuation guarantee charge', subtitle: 'Superannuation guarantee charge amounts' }),
    )
    expect(result.kind).toBe('needs_manual')
    if (result.kind !== 'needs_manual') return
    expect(result.reason).toBe('sgc')
    expect(result.partial.type).toBe('sgc')
    expect(result.partial.reference).toBe(SYNTHETIC.reference)
  })

  it('names the missing fields', () => {
    const result = parseDirectorPenaltyNotice(noticeLines({ withoutTo: true }))
    expect(result).toMatchObject({ kind: 'needs_manual', reason: 'missing_fields', missing: ['directorName'] })
  })
})

describe('parseDirectorPenaltyNotice — a value wrapped over two lines', () => {
  it('reads the company name from the lines above and below its label', () => {
    // No page-3 statement either: the name comes from page 1 alone.
    const notice = parsed(noticeLines({ companyWraps: true, withoutStatedCompany: true }))
    expect(notice.companyName).toBe(SYNTHETIC.longCompany)
    expect(notice.acn).toBe(SYNTHETIC.acn)
    expect(notice.type).toBe('paygw')
  })

  it('falls back to the page-3 statement when page 1 gives no name', () => {
    const lines = noticeLines({ companyWraps: true })
    // Remove the wrapped value lines from page 1, leaving the label alone.
    lines[0] = lines[0].filter((line) => !/^(EXAMPLE TRADING & SERVICES PTY|LTD)$/.test(line.text))
    expect(parsed(lines).companyName).toBe(SYNTHETIC.longCompany)
  })

  it('still reads a name printed on one line', () => {
    expect(parsed(noticeLines({ withoutStatedCompany: true })).companyName).toBe(SYNTHETIC.company)
  })
})

describe('parseDirectorPenaltyNotice — three-column table (no Column 4/5 split)', () => {
  it('reads Columns 2 and 3 on both pages, with Column 4 = Column 3 and Column 5 = 0', () => {
    const notice = parsed(noticeLines({ threeColumn: true }))
    expect(notice.tableLayout).toBe('three_column')
    expect(notice.rows).toHaveLength(THREE_COLUMN_ROWS.page3.length + THREE_COLUMN_ROWS.page4.length)
    expect(notice.rows[2]).toEqual({ periodFrom: '2023-07-01', periodTo: '2023-09-30', column2: 2_000_000, column3: 1_800_000, column4: 1_800_000, column5: 0 })
    expect(notice.totals).toEqual(THREE_COLUMN_TOTALS)
  })

  it('marks the usual table five_column', () => {
    expect(parsed().tableLayout).toBe('five_column')
  })

  it('does not trust a three-column table without the paragraph that remits the whole table', () => {
    const result = parseDirectorPenaltyNotice(noticeLines({ threeColumn: true, remitsWholeTable: false }))
    expect(result).toMatchObject({ kind: 'needs_manual', reason: 'table_unreadable' })
  })
})

describe('parseNoticeDate', () => {
  it.each([
    ['30 September 2026', '2026-09-30'],
    ['01 JAN 2025', '2025-01-01'],
    ['1 Sept 2025', '2025-09-01'],
    ['30/09/2026', '2026-09-30'],
  ])('reads %s', (raw, iso) => {
    expect(parseNoticeDate(raw)).toBe(iso)
  })

  it.each(['31 FEB 2026', '30 Smarch 2026', 'tomorrow'])('refuses %s', (raw) => {
    expect(parseNoticeDate(raw)).toBeNull()
  })
})

describe('parseMoney', () => {
  it.each([
    ['1,234.56', 123_456],
    ['$1,234.56', 123_456],
    ['0.00', 0],
    ['123456.78', 12_345_678],
    ['-1,234.56', -123_456],
    ['(1,234.56)', -123_456],
    ['1,234.56 CR', -123_456],
  ])('reads %s', (raw, cents) => {
    expect(parseMoney(raw)).toBe(cents)
  })

  it.each(['1,234', '12,34.56', '(1.00', 'Column 2'])('refuses %s', (raw) => {
    expect(parseMoney(raw)).toBeNull()
  })
})
