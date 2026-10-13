// @vitest-environment node
import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { MAX_UPLOAD_BYTES } from '../config'
import { rejectedRowsCsv } from '../csv'
import { templateCsv } from '../headers'
import { UploadError, parseUpload } from '../parseUpload'
import { previewUpload } from '../preview'
import { BASE_CELLS, TEMPLATE_HEADER, csvLine } from './fixtures'

const bytes = (text: string) => new TextEncoder().encode(text)

/** A synthetic workbook: each tab is rows of cells from A1 (or `origin`). */
function workbook(tabs: Record<string, unknown[][]>, origin = 'A1', bookType: XLSX.BookType = 'xlsx') {
  const wb = XLSX.utils.book_new()
  for (const [name, rows] of Object.entries(tabs)) {
    const ws = XLSX.utils.aoa_to_sheet([])
    XLSX.utils.sheet_add_aoa(ws, rows, { origin })
    XLSX.utils.book_append_sheet(wb, ws, name)
  }
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType }) as ArrayBuffer)
}

const HEADER = TEMPLATE_HEADER.split(',')
const row = (overrides: Partial<typeof BASE_CELLS> = {}) => Object.values({ ...BASE_CELLS, ...overrides })

describe('parseUpload: CSV', () => {
  it('matches headers whatever their case, spacing and punctuation, and ignores extra columns', () => {
    const header = [
      'client name', 'BUSINESS TYPE', 'D.P.N', 'Number Of Creditors', 'Creditor  Amount',
      'accepted / rejected', 'SBR payment', 'Payment plan or Upfront',
      'Receivable Director Loan At Appointment', 'Director Loan Receivable Amount (Sent to ATO)',
      'Cumulative Days of Late Lodgement', 'Number of Late Lodgements', 'Days since last payment',
      'C / $', 'Notes',
    ].join(',')
    const line = [
      'Example Trading Pty Ltd', 'Retail', 'N', '3', '"250,000.00"', 'Accepted', '"100,000.00"',
      'Plan', 'N', '0', '450', '9', '120', '35.0', 'anything',
    ].join(',')
    const parsed = parseUpload(bytes(`﻿${header}\r\n${line}\r\n`), 'cases.CSV')
    expect(parsed.tabs).toEqual([{ tab: null, status: 'read', rows: 1, detail: null }])
    expect(parsed.rows[0].cells.clientName).toBe('Example Trading Pty Ltd')
    expect(parsed.rows[0].raw.Notes).toBe('anything')
    expect(parsed.rows[0].ref).toEqual({ tab: null, rowNumber: 2 })
  })

  it('keeps spreadsheet row numbers across blank lines', () => {
    const csv = [TEMPLATE_HEADER, csvLine(BASE_CELLS), '', ',,,', csvLine({ ...BASE_CELLS, clientName: 'Second' })].join('\n')
    expect(parseUpload(bytes(csv), 'a.csv').rows.map((r) => r.ref.rowNumber)).toEqual([2, 5])
  })

  it('names the missing columns when the header is incomplete', () => {
    const csv = 'Client Name,DPN,Creditor amount,SBR Payment\nExample,N,1,1\n'
    expect(() => parseUpload(bytes(csv), 'a.csv')).toThrow(/missing: .*Accepted\/Rejected.*C\/\$/)
  })

  it('refuses other file types, empty files and files over the limit before reading them', () => {
    expect(() => parseUpload(bytes('x'), 'cases.pdf')).toThrow(UploadError)
    expect(() => parseUpload(new Uint8Array(), 'a.csv')).toThrow('The file is empty.')
    expect(() => parseUpload(new Uint8Array(MAX_UPLOAD_BYTES + 1), 'a.xlsx')).toThrow(/larger than 5 MB/)
  })
})

describe('parseUpload: Excel', () => {
  it('reads every tab whose header matches, skips the rest, and keeps numbers exact', () => {
    const file = workbook({
      'Old Data ': [HEADER, row({ clientName: 'Alpha', creditorAmount: 317450.6 as never })],
      'New Data': [HEADER.map((h) => h.toLowerCase()), row({ clientName: 'Bravo' }), [], row({ clientName: 'Charlie' })],
      Notes: [['Anything else'], ['here']],
    })
    const parsed = parseUpload(file, 'book.xlsx')
    expect(parsed.tabs).toEqual([
      { tab: 'Old Data', status: 'read', rows: 1, detail: null },
      { tab: 'New Data', status: 'read', rows: 2, detail: null },
      { tab: 'Notes', status: 'skipped', rows: 0, detail: null },
    ])
    expect(parsed.rows.map((r) => [r.ref.tab, r.ref.rowNumber])).toEqual([
      ['Old Data', 2],
      ['New Data', 2],
      ['New Data', 4],
    ])
    expect(parsed.rows[0].cells.creditorAmount).toBe(317450.6)
  })

  it('finds a header below a title, and row numbers follow the sheet', () => {
    const file = workbook({ Data: [['Historical SBR cases'], HEADER, row()] }, 'B3')
    const parsed = parseUpload(file, 'book.xlsx')
    expect(parsed.rows[0].ref).toEqual({ tab: 'Data', rowNumber: 5 })
  })

  it('reads the legacy .xls format', () => {
    const file = workbook({ Data: [HEADER, row()] }, 'A1', 'biff8')
    expect(parseUpload(file, 'book.xls').rows).toHaveLength(1)
  })

  it('refuses a file that is not really a workbook, before parsing it', () => {
    expect(() => parseUpload(bytes('this is not a spreadsheet'), 'book.xlsx')).toThrow(/doesn't look like an Excel file/)
    // An .xlsx renamed .xls (and the reverse) is refused too.
    const xlsx = workbook({ Data: [HEADER, row()] })
    expect(() => parseUpload(xlsx, 'book.xls')).toThrow(UploadError)
    const xls = workbook({ Data: [HEADER, row()] }, 'A1', 'biff8')
    expect(() => parseUpload(xls, 'book.xlsx')).toThrow(UploadError)
  })
})

describe('template and rejected rows', () => {
  it('the template imports as one new case', () => {
    const preview = previewUpload(bytes(templateCsv()), 'template.csv', [])
    expect(preview.counts).toEqual({ added: 1, corrections: 0, already_have: 0, details_added: 0, rejected: 0 })
    expect(preview.added[0].record).toMatchObject({ payment_plan_type: 'plan', term_months: 24 })
  })

  it('the rejected-rows CSV carries the reasons and uploads again with the same result', () => {
    const csv = [
      TEMPLATE_HEADER,
      csvLine({ ...BASE_CELLS, clientName: 'Alpha', paymentType: 'Upfront and Plan' }),
      csvLine({ ...BASE_CELLS, clientName: '=HYPERLINK("x")', outcome: 'Cancelled' }),
    ].join('\n')
    const first = previewUpload(bytes(csv), 'a.csv', [])
    const out = rejectedRowsCsv(first.rejected)

    expect(out.split('\r\n')[0]).toBe(`${TEMPLATE_HEADER},Reason,Source`)
    expect(out).toContain('Payment type ""Upfront and Plan"" not supported yet.')
    // A formula-like cell is defused for spreadsheets...
    expect(out).toContain(`"'=HYPERLINK(""x"")"`)

    // ...and reads back as written.
    const again = previewUpload(bytes(out), 'rejected.csv', [])
    expect(again.rejected.map((r) => [r.clientName, r.reasons.map((x) => x.code)])).toEqual([
      ['Alpha', ['payment_type']],
      ['=HYPERLINK("x")', ['outcome']],
    ])
  })
})
