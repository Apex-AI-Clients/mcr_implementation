import { describe, it, expect } from 'vitest'
import {
  LEAD_SHEET_HEADERS,
  LEAD_SHEET_WIDTHS,
  buildLeadsWorkbook,
  leadsSheetData,
} from '../workbook'
import type { Lead, LeadActivity } from '@/types/leads'

/**
 * The spreadsheet export.
 *
 * The sheet is built as plain data first and written second, so the parts
 * worth asserting — widths, wrapping, numbers staying numbers — can be
 * checked without writing a file and unzipping it again. One test at the end
 * does write a real workbook, to catch the library contract changing.
 */

function makeLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: 'ld_1',
    name: 'Dean Whitlock',
    email: 'dean@whitlockcivil.com.au',
    phone: '0407552118',
    debtMin: 150_000,
    debtMax: null,
    state: 'QLD',
    entityType: 'company',
    message: null,
    preferredCallTime: null,
    stage: 'prospect',
    source: 'website',
    company: null,
    nextStep: null,
    stageSince: '2026-08-20T00:00:00.000Z',
    lastActionAt: '2026-08-30T00:00:00.000Z',
    convertedClientId: null,
    metaFormId: null,
    metaAdId: null,
    metaAdgroupId: null,
    metaPageId: null,
    metaCampaignId: null,
    metaCampaignName: null,
    metaAdName: null,
    metaAccountId: null,
    metaStateRaw: null,
    metaStateOptions: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-30T00:00:00.000Z',
    ...overrides,
  }
}

function act(overrides: Partial<LeadActivity> = {}): LeadActivity {
  return {
    id: 'ac_1',
    leadId: 'ld_1',
    type: 'note',
    body: 'Spoke about the BAS arrears.',
    author: 'Gabby',
    createdAt: '2026-08-10T00:00:00.000Z',
    ...overrides,
  }
}

/** Column index by header, so these tests survive a column being reordered. */
function col(header: string): number {
  const index = LEAD_SHEET_HEADERS.indexOf(header)
  expect(index).toBeGreaterThan(-1)
  return index
}

describe('leadsSheetData', () => {
  it('puts a bold header row first', () => {
    const [header] = leadsSheetData([])
    expect(header).toHaveLength(LEAD_SHEET_HEADERS.length)
    expect(header.every((cell) => cell?.fontWeight === 'bold')).toBe(true)
  })

  it('gives one row per lead', () => {
    const rows = leadsSheetData([makeLead({ id: 'a' }), makeLead({ id: 'b' })])
    expect(rows).toHaveLength(3) // header + two
  })

  it('sets a width for every column', () => {
    // These are what stop anyone dragging a column before the file is
    // readable, which is the whole reason this is not a CSV.
    expect(LEAD_SHEET_WIDTHS).toHaveLength(LEAD_SHEET_HEADERS.length)
    expect(LEAD_SHEET_WIDTHS.every((column) => column.width > 0)).toBe(true)
  })

  it('wraps the prose columns and nothing else', () => {
    // Wrapping a phone number or a stage achieves nothing and costs row
    // height, which was the complaint about the CSV in the first place.
    const [, row] = leadsSheetData([makeLead()])
    expect(row[col('Notes')]?.wrap).toBe(true)
    expect(row[col('Message')]?.wrap).toBe(true)
    expect(row[col('Phone')]?.wrap).toBeFalsy()
    expect(row[col('Stage')]?.wrap).toBeFalsy()
    expect(row[col('Name')]?.wrap).toBeFalsy()
  })

  it('top-aligns cells so a tall row does not float its other columns', () => {
    const [, row] = leadsSheetData([makeLead()])
    expect(row[col('Name')]?.alignVertical).toBe('top')
  })

  it('keeps debt as a number, not text', () => {
    // The point of two debt columns is that a spreadsheet can sort on them.
    const [, row] = leadsSheetData([makeLead({ debtMin: 150_000 })])
    const cell = row[col('Debt min')]
    expect(cell?.value).toBe(150_000)
    expect(cell?.type).toBe(Number)
  })

  it('leaves an unknown debt empty rather than zero', () => {
    // A 0 would sort as though the lead owed nothing, which is a different
    // claim from not knowing.
    const [, row] = leadsSheetData([makeLead({ debtMin: null, debtMax: null })])
    expect(row[col('Debt min')]).toBeNull()
    expect(row[col('Debt max')]).toBeNull()
  })

  it('carries the notes and their count', () => {
    const rows = leadsSheetData(
      [makeLead({ id: 'ld_1' })],
      new Map([['ld_1', [act(), act({ id: 'ac_2', type: 'call', body: 'Left a voicemail.' })]]]),
    )
    const row = rows[1]
    expect(row[col('Notes count')]?.value).toBe(2)
    expect(String(row[col('Notes')]?.value)).toContain('Spoke about the BAS arrears.')
    expect(String(row[col('Notes')]?.value)).toContain('Left a voicemail.')
  })

  it('counts no notes as zero, not as unknown', () => {
    // The opposite of the debt columns, and deliberately so: a lead with no
    // notes genuinely has none, whereas a lead with no debt figure is one
    // nobody has asked. A filter for "untouched" wants the 0 to be there.
    const [, row] = leadsSheetData([makeLead()])
    expect(row[col('Notes')]?.value).toBe('')
    expect(row[col('Notes count')]?.value).toBe(0)
  })
})

describe('buildLeadsWorkbook', () => {
  it('produces a real xlsx file', async () => {
    const buffer = await buildLeadsWorkbook(
      [makeLead()],
      new Map([['ld_1', [act()]]]),
    )

    expect(buffer.length).toBeGreaterThan(0)
    // xlsx is a zip archive, so it opens with the PK local-file-header magic.
    // Cheap, but it is the difference between "returned bytes" and "returned
    // bytes a spreadsheet will open".
    expect(buffer.subarray(0, 2).toString('latin1')).toBe('PK')
  })

  it('handles an empty export without throwing', async () => {
    const buffer = await buildLeadsWorkbook([])
    expect(buffer.subarray(0, 2).toString('latin1')).toBe('PK')
  })

  it('actually writes the widths and the wrapping into the file', async () => {
    // The point of the whole format change. Asserting the data structure
    // proves the intent; this proves the file a person opens carries it —
    // twice now an export has looked right here and wrong in Excel.
    const { unzipSync, strFromU8 } = await import('fflate')
    const buffer = await buildLeadsWorkbook([makeLead()], new Map([['ld_1', [act()]]]))

    const files = unzipSync(new Uint8Array(buffer))
    const sheet = strFromU8(files['xl/worksheets/sheet1.xml'])
    const styles = strFromU8(files['xl/styles.xml'])

    // A <col> entry per column, each carrying a width.
    const cols = sheet.match(/<col /g) ?? []
    expect(cols).toHaveLength(LEAD_SHEET_HEADERS.length)
    expect(sheet).toContain('width=')
    // Wrapping lives in the style table, not on the cell.
    expect(styles).toContain('wrapText="1"')
    // And the header is frozen.
    expect(sheet).toContain('<pane')
  })
})
