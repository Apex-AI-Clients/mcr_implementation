import { describe, expect, it } from 'vitest'
import { answerToLines, continuationContext, parseScanAnswer, ScanAnswerError } from '../claudeReader'
import { ocrTitle } from '../ocr'

/** The pure parts of reading a scan with Claude. Synthetic only. */

const good = {
  title: 'Balance Sheet',
  title_block: ['Example Trust', 'As at 30 June 2023'],
  columns: ['2023', '2022'],
  rows: [
    { label: 'Assets', section: [], amounts: [null, null], top: 0.2 },
    { label: 'Current Assets', section: ['Assets'], amounts: [null, null], top: 0.21 },
    { label: 'Cash at Bank', section: ['Assets', 'Current Assets'], amounts: ['1,000', '(200)'], top: 0.22 },
  ],
}

describe("Claude's transcription", () => {
  it('lays it out as printed lines: title, header, each label indented by the sections it sits under, figures in their columns', () => {
    const lines = answerToLines(parseScanAnswer(JSON.stringify(good)))
    expect(lines.map((l) => l.text)).toEqual(['Balance Sheet', 'Example Trust', 'As at 30 June 2023', '2023 2022', 'Assets', 'Current Assets', 'Cash at Bank 1,000 (200)'])
    expect(lines[5].cells[0].x).toBeGreaterThan(lines[4].cells[0].x)
    expect(lines[6].cells[0].x).toBeGreaterThan(lines[5].cells[0].x)
    expect(lines[6].band[0]).toBeCloseTo(0.212)
  })

  it('refuses an answer that is not the schema, never repairing it', () => {
    expect(() => parseScanAnswer('Here is the table: …')).toThrow(ScanAnswerError)
    expect(() => parseScanAnswer(JSON.stringify({ ...good, rows: [{ label: 'Cash', section: [], amounts: ['1'] }] }))).toThrow(/1 amounts for 2 columns/)
    expect(() => parseScanAnswer(JSON.stringify({ ...good, extra: true }))).toThrow(ScanAnswerError)
    // The earlier "indent" answers are not this schema.
    expect(() => parseScanAnswer(JSON.stringify({ ...good, rows: [{ label: 'Cash', indent: 1, amounts: ['1', '2'] }] }))).toThrow(ScanAnswerError)
  })

  it('a page that is not a statement gives no lines', () => {
    expect(answerToLines(parseScanAnswer(JSON.stringify({ title: null, title_block: [], columns: [], rows: [] })))).toEqual([])
  })
})

describe('finding the statement pages (Tesseract, titles only)', () => {
  it('reads a statement title the way OCR prints it', () => {
    expect(ocrTitle('Profit Loss Statement cL oN')).toBe('Profit & Loss Statement')
    expect(ocrTitle('Profit & Loss Statement.')).toBe('Profit & Loss Statement')
    expect(ocrTitle('Balance Sheet')).toBe('Balance Sheet')
    expect(ocrTitle('balance sheet as at 30 June 2023 has been prepared from the records')).toBeNull()
    expect(ocrTitle('Notes to the Financial Statements')).toBeNull()
  })
})

describe('a statement continued overleaf', () => {
  const page = (rows: { label: string; section: string[]; amounts: (string | null)[] }[]) => parseScanAnswer(JSON.stringify({ ...good, rows: rows.map((r) => ({ ...r, top: 0.5 })) }))

  it('tells the next page which sections were still open', () => {
    expect(continuationContext(page([{ label: 'Loan', section: ['Liabilities', 'Non-Current Liabilities'], amounts: ['1', '2'] }]))).toMatch(
      /still open, outermost first: \["Liabilities","Non-Current Liabilities"\]/,
    )
  })

  it('a total closes the section it totals; a heading at the foot of the page opens one', () => {
    expect(continuationContext(page([{ label: 'Total Current Liabilities', section: ['Liabilities', 'Current Liabilities'], amounts: ['1', '2'] }]))).toMatch(
      /\["Liabilities"\]/,
    )
    expect(continuationContext(page([{ label: 'Non-Current Liabilities', section: ['Liabilities'], amounts: [null, null] }]))).toMatch(
      /\["Liabilities","Non-Current Liabilities"\]/,
    )
  })

  it('says nothing when there is no page before', () => {
    expect(continuationContext(null)).toBe('')
  })
})
