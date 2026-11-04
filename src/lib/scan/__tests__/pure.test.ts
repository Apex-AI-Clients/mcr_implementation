import { describe, expect, it } from 'vitest'
import { ocrToLines, type OcrLine } from '../ocrLines'
import { answerToLines, parseScanAnswer, ScanAnswerError } from '../claudeReader'
import { normLabel } from '../reconcile'
import { ocrTitle } from '../readScanned'

/** The pure parts of reading a scan. Synthetic only. */

const word = (text: string, x0: number, x1: number, confidence = 95, y = 100) => ({ text, confidence, x0, x1, y0: y, y1: y + 20 })
const IMAGE = { width: 1654, height: 2339 }
const PAGE = { widthPt: 595, heightPt: 842 }

describe('Tesseract lines', () => {
  it('splits a label from its figures, keeps a narrow nil dash, and drops ruling-line junk', () => {
    const lines: OcrLine[] = [
      { words: [word('Insurance', 200, 330), word('Recoveries', 340, 480), word('218,316', 1230, 1300), word('-', 1452, 1458)] },
      // A heading's underline: a wide dash fragment and a low-confidence scrap among the figures.
      { words: [word('Cost', 200, 260), word('of', 270, 300), word('Sales', 310, 390), word('—', 1170, 1250, 60), word('a', 1290, 1300, 30)] },
      // A ruling line read as letters, spread across the page.
      { words: [word('J', 190, 200, 40), word('SSSR', 210, 1450, 40)] },
    ]
    const out = ocrToLines(lines, IMAGE, PAGE)
    expect(out.map((l) => l.cells.map((c) => c.text))).toEqual([['Insurance Recoveries', '218,316', '-'], ['Cost of Sales']])
    expect(out[0].band[0]).toBeCloseTo(100 / 2339)
  })

  it('reads a statement title the way OCR prints it', () => {
    expect(ocrTitle('Profit Loss Statement cL oN')).toBe('Profit & Loss Statement')
    expect(ocrTitle('Profit & Loss Statement.')).toBe('Profit & Loss Statement')
    expect(ocrTitle('Balance Sheet')).toBe('Balance Sheet')
    expect(ocrTitle('balance sheet as at 30 June 2023 has been prepared from the records')).toBeNull()
    expect(ocrTitle('Notes to the Financial Statements')).toBeNull()
  })

  it('matches labels across an OCR slip of a letter', () => {
    expect(normLabel('Office Expenses')).toBe(normLabel('0ffice Expenses'))
  })
})

describe("Claude's transcription", () => {
  const good = {
    title: 'Balance Sheet',
    title_block: ['Example Trust', 'As at 30 June 2023'],
    columns: ['2023', '2022'],
    rows: [
      { label: 'Assets', indent: 0, amounts: [null, null], top: 0.2 },
      { label: 'Cash at Bank', indent: 1, amounts: ['1,000', '(200)'], top: 0.22 },
    ],
  }

  it('lays the transcription out as printed lines: title, header, labels indented, figures in their columns', () => {
    const lines = answerToLines(parseScanAnswer(JSON.stringify(good)))
    expect(lines.map((l) => l.text)).toEqual(['Balance Sheet', 'Example Trust', 'As at 30 June 2023', '2023 2022', 'Assets', 'Cash at Bank 1,000 (200)'])
    expect(lines[5].cells[0].x).toBeGreaterThan(lines[4].cells[0].x)
  })

  it('refuses an answer that is not the schema, never repairing it', () => {
    expect(() => parseScanAnswer('Here is the table: …')).toThrow(ScanAnswerError)
    expect(() => parseScanAnswer(JSON.stringify({ ...good, rows: [{ label: 'Cash', indent: 1, amounts: ['1'] }] }))).toThrow(/1 amounts for 2 columns/)
    expect(() => parseScanAnswer(JSON.stringify({ ...good, extra: true }))).toThrow(ScanAnswerError)
  })

  it('a page that is not a statement gives no lines', () => {
    expect(answerToLines(parseScanAnswer(JSON.stringify({ title: null, title_block: [], columns: [], rows: [] })))).toEqual([])
  })
})
