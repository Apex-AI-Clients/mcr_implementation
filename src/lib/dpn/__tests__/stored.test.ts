import { describe, it, expect } from 'vitest'
import { parseDirectorPenaltyNotice } from '../parse'
import { noticeFieldsFromParse, noticeIssues, toStoredNotice, type NoticeRow } from '../stored'
import { ManualNoticeSchema, centsToTyped, parseTypedAmount } from '../manualEntry'
import { buildDpnPanel, formatCents, sydneyToday } from '../view'
import { SYNTHETIC, noticeLines } from './fixtures/notice'

/** Stored notices, their issues, and the manual form's rules. Synthetic data only. */

function asRow(fields: ReturnType<typeof noticeFieldsFromParse>, overrides: Partial<NoticeRow> = {}): NoticeRow {
  return {
    id: 'n1',
    client_id: 'c1',
    document_id: 'd1',
    created_at: '2026-10-17T00:00:00Z',
    updated_at: '2026-10-17T00:00:00Z',
    acn: null,
    company_name: null,
    director_name: null,
    entered_at: null,
    entered_by: null,
    issued_on: null,
    manual_reason: null,
    notice_type: null,
    parser_version: null,
    reference: null,
    review_reasons: [],
    rows: [],
    total_column2: null,
    total_column3: null,
    total_column4: null,
    total_column5: null,
    ...(fields as Partial<NoticeRow>),
    source: fields.source,
    status: fields.status,
    ...overrides,
  }
}

const FILE = { acn: SYNTHETIC.acn, directors: [{ name: 'Jane Quinn Sample' }] }

describe('noticeFieldsFromParse', () => {
  it('stores a clean read as read, with totals and no address', () => {
    const fields = noticeFieldsFromParse(parseDirectorPenaltyNotice(noticeLines()))
    expect(fields).toMatchObject({
      source: 'parsed',
      status: 'read',
      manual_reason: null,
      director_name: SYNTHETIC.director,
      acn: SYNTHETIC.acn,
    })
    expect(fields.total_column3).toBeGreaterThan(0)
    const everything = JSON.stringify(fields)
    expect(everything).not.toContain(SYNTHETIC.street)
    expect(everything).not.toContain(SYNTHETIC.suburb)
  })

  it('sends a notice with a negative amount to review, naming the rows', () => {
    const lines = noticeLines({
      page3Rows: [['01 JAN 2025 to 31 MAR 2025', '-1,000.00', '500.00', '500.00', '0.00']],
      page4Rows: [],
    })
    const fields = noticeFieldsFromParse(parseDirectorPenaltyNotice(lines))
    expect(fields.status).toBe('needs_review')
    expect(fields.review_reasons).toEqual([{ code: 'negative_amount', rowIndexes: [0] }])
  })

  it('keeps what a partial read found, for the manual form', () => {
    const fields = noticeFieldsFromParse(
      parseDirectorPenaltyNotice(noticeLines({ noticeFor: 'superannuation guarantee charge' })),
    )
    expect(fields).toMatchObject({ status: 'needs_manual', manual_reason: 'sgc', reference: SYNTHETIC.reference })
  })

  it('records an unreadable PDF and a file that is not a notice', () => {
    expect(noticeFieldsFromParse({ kind: 'pdf_unreadable' })).toMatchObject({
      status: 'needs_manual',
      manual_reason: 'pdf_unreadable',
    })
    expect(noticeFieldsFromParse({ kind: 'not_a_dpn' })).toMatchObject({
      status: 'needs_manual',
      manual_reason: 'not_a_dpn',
    })
  })
})

describe('noticeIssues', () => {
  const stored = () => toStoredNotice(asRow(noticeFieldsFromParse(parseDirectorPenaltyNotice(noticeLines()))))

  it('has nothing to say when the notice agrees with the file', () => {
    expect(noticeIssues(stored(), FILE)).toEqual([])
  })

  it('says which ACN each side has when they differ', () => {
    expect(noticeIssues(stored(), { ...FILE, acn: '123456780' })).toEqual([
      'This notice is for ACN 000 000 019, but the client file has ACN 123 456 780.',
    ])
  })

  it('names the director who is not on file', () => {
    expect(noticeIssues(stored(), { ...FILE, directors: [{ name: 'Raj Example' }] })).toEqual([
      `This notice is addressed to ${SYNTHETIC.director}, who is not among the directors on the client file.`,
    ])
  })

  it('explains a negative amount', () => {
    const notice = { ...stored(), reviewReasons: [{ code: 'negative_amount' as const, rowIndexes: [0, 2] }] }
    expect(noticeIssues(notice, FILE)[0]).toMatch(/^Rows 1, 3 show a negative amount/)
  })

  it('does not check a notice still waiting for manual entry', () => {
    const notice = toStoredNotice(asRow(noticeFieldsFromParse({ kind: 'pdf_unreadable' })))
    expect(noticeIssues(notice, { acn: null, directors: [] })).toEqual([])
  })
})

describe('manual entry', () => {
  const valid = {
    reference: '1234567890123',
    issuedOn: '2026-09-30',
    type: 'gst',
    companyName: 'EXAMPLE TRADING PTY LTD',
    acn: '000 000 019',
    directorName: 'Jane Sample',
    rows: [{ periodFrom: '2025-01-01', periodTo: '2025-03-31', column2: 100, column3: 90, column4: 80, column5: 10 }],
  }

  it('accepts a complete notice and tidies the ACN', () => {
    const parsed = ManualNoticeSchema.parse(valid)
    expect(parsed.acn).toBe('000000019')
  })

  it.each([
    [{ acn: '12345' }, 'An ACN is 9 digits.'],
    [{ issuedOn: '2026-02-30' }, 'That date does not exist.'],
    [{ rows: [] }, 'Add at least one period.'],
    [{ directorName: ' ' }, "Enter the director's name."],
  ])('refuses %o', (change, message) => {
    const result = ManualNoticeSchema.safeParse({ ...valid, ...change })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0].message).toBe(message)
  })

  it('refuses a period that ends before it starts', () => {
    const rows = [{ ...valid.rows[0], periodFrom: '2025-04-01' }]
    expect(ManualNoticeSchema.safeParse({ ...valid, rows }).success).toBe(false)
  })

  it.each([
    ['1234', 123_400],
    ['1,234.5', 123_450],
    ['$1,234.56', 123_456],
    ['-12.00', -1_200],
    ['0', 0],
  ])('reads a typed amount %s', (raw, cents) => {
    expect(parseTypedAmount(raw)).toBe(cents)
  })

  it.each(['', 'abc', '1.234', '12,34'])('refuses a typed amount %s', (raw) => {
    expect(parseTypedAmount(raw)).toBeNull()
  })

  it('shows cents back as typed text', () => {
    expect(centsToTyped(123_456)).toBe('1234.56')
  })
})

describe('buildDpnPanel', () => {
  const client = { no_dpn_confirmed_at: null, no_dpn_confirmed_by: null, no_dpn_cleared_note: null }

  it('lists every DPN file, read or not, with its deadline', () => {
    const fields = noticeFieldsFromParse(parseDirectorPenaltyNotice(noticeLines()))
    const panel = buildDpnPanel({
      documents: [
        { id: 'd1', originalFilename: 'notice.pdf' },
        { id: 'd2', originalFilename: 'older.pdf' },
      ],
      noticeRows: [asRow(fields)],
      client,
      file: FILE,
      todayIso: '2026-10-17',
    })
    expect(panel.notices.map((n) => [n.documentId, n.notice?.status ?? null, n.deadline])).toEqual([
      ['d1', 'read', '2026-10-21'],
      ['d2', null, null],
    ])
    expect(panel.noneIssued).toBeNull()
  })

  it('carries the tick and the cleared note', () => {
    const panel = buildDpnPanel({
      documents: [],
      noticeRows: [],
      client: { no_dpn_confirmed_at: '2026-10-10T00:00:00Z', no_dpn_confirmed_by: 'Sam', no_dpn_cleared_note: null },
      file: FILE,
      todayIso: '2026-10-17',
    })
    expect(panel.noneIssued).toEqual({ by: 'Sam', at: '2026-10-10T00:00:00Z' })
  })

  it('treats a client row from before migration 0030 as unticked', () => {
    const panel = buildDpnPanel({
      documents: [],
      noticeRows: [],
      client: {} as typeof client,
      file: FILE,
      todayIso: '2026-10-17',
    })
    expect(panel.noneIssued).toBeNull()
    expect(panel.clearedNote).toBeNull()
  })
})

describe('formatting', () => {
  it('formats cents as dollars', () => {
    expect(formatCents(1_234_567)).toBe('$12,345.67')
    expect(formatCents(-500)).toBe('-$5.00')
  })

  it("takes today's date in Sydney, not UTC", () => {
    // 15:00 UTC on 16 Oct is 2am on 17 Oct in Sydney (AEDT, UTC+11).
    expect(sydneyToday(new Date('2026-10-16T15:00:00Z'))).toBe('2026-10-17')
  })
})
