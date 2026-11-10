// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildPrintedComparison } from '@/lib/printed/compare'
import { verifyStatements } from '@/lib/printed/verify'
import { readScannedPdf, scannedPages, type ClaudeReply, type ScanReader } from '../readScanned'
import { parseScanAnswer } from '../claudeReader'
import { tesseractTitles, type TitleReader } from '../ocr'
import { answerFor, profitAndLoss, profitAndLossAnswer, scannedPdf, type SyntheticPage } from './fixtures'

/**
 * Scanned statements: synthetic image PDFs, Tesseract reading the page titles
 * for real (on this machine), Claude replaced by fixed transcriptions per
 * page. No real client data, no network.
 */

let titles: TitleReader
beforeAll(async () => {
  titles = await tesseractTitles()
}, 60_000)
afterAll(async () => {
  await titles?.close()
})

const reply = (text: string): ClaudeReply => ({ text, model: 'anthropic/claude-sonnet-5.5', generationId: 'gen-test', tokensIn: 5000, tokensOut: 1000 })
/** A stand-in for Claude: the transcription of each page, and which pages it was sent. */
function fakeClaude(pages: Record<number, string>) {
  const asked: { page: number; context: string }[] = []
  const reader: ScanReader = {
    transcribe: async (_image, page, context) => {
      asked.push({ page, context })
      return reply(pages[page] ?? JSON.stringify({ title: null, title_block: [], columns: [], rows: [] }))
    },
  }
  return { reader, asked }
}

const cover: SyntheticPage = { text: ['Example Family Trust', 'Financial Statements', 'For the year ended 30 June 2023'] }
const notes: SyntheticPage = { title: 'Notes to the Financial Statements', text: ['1. Summary of significant accounting policies'] }
const doc = (read: NonNullable<Awaited<ReturnType<typeof readScannedPdf>>>['read']) => [{ documentId: 'fy23', filename: 'fy23.pdf', uploadedAt: '', read }]

describe('scanned statements, read by Claude', () => {
  it('finds the scanned pages, page by page: a text-layer page is never sent anywhere', async () => {
    const pdf = await scannedPdf([cover, profitAndLoss()], { textPages: new Map([[0, ['Example Family Trust', 'Financial Statements for the year ended 30 June 2023']]]) })
    const { scanned } = await scannedPages(pdf)
    expect(scanned).toEqual([2])
  })

  it('sends only the statement pages to Claude: the cover and notes are found by their titles on our server and never leave it', async () => {
    const pdf = await scannedPdf([cover, profitAndLoss(), notes])
    const { reader, asked } = fakeClaude({ 2: profitAndLossAnswer() })
    const res = (await readScannedPdf(pdf, { titles, reader, pagesAllowed: 60 }))!
    expect(res.pages.map((p) => [p.page, p.role])).toEqual([
      [1, 'skipped'],
      [2, 'statement'],
      [3, 'skipped'],
    ])
    expect(res.pages[2].note).toMatch(/^Not a statement page \("Notes to the Financial Statements/)
    expect(asked.map((a) => a.page)).toEqual([2])
    expect(res.transcribed).toBe(1)
  })

  it('accepts every figure as read: no second reading, no figures to choose, every printed total adds up', async () => {
    const pdf = await scannedPdf([profitAndLoss()])
    const { reader } = fakeClaude({ 1: profitAndLossAnswer() })
    const res = (await readScannedPdf(pdf, { titles, reader, pagesAllowed: 60 }))!
    const st = res.read.statements[0]
    const rows = st.rows.filter((r) => r.scan)
    expect(rows.map((r) => r.label)).toEqual(['Sales', 'Interest Income', 'Total Income', 'Rent', 'Wages', 'Total Expenses', 'Net Profit'])
    expect(rows.flatMap((r) => r.scan!.cells.map((c) => c.status)).every((s) => s === 'read')).toBe(true)
    expect(st.rows.find((r) => r.label === 'Rent')!.path).toEqual(['Expenses'])
    expect(rows.find((r) => r.label === 'Interest Income')!.amounts).toEqual([600, null])
    expect(verifyStatements(res.read.statements).filter((c) => c.status === 'mismatch' || c.status === 'wrong_column')).toEqual([])
    expect(buildPrintedComparison(doc(res.read)).failures).toEqual([])
    expect(res.read.scan!.message).toBeNull()
  })

  it('flags a printed total that does not add up, as for any statement', async () => {
    const pdf = await scannedPdf([profitAndLoss({ wrongTotal: true })])
    const { reader } = fakeClaude({ 1: profitAndLossAnswer({ change: { label: 'Total Expenses', column: 0, to: '86,500' } }) })
    const res = (await readScannedPdf(pdf, { titles, reader, pagesAllowed: 60 }))!
    const failures = buildPrintedComparison(doc(res.read)).failures
    // The wrong total, and the net profit it no longer adds up to: ordinary failed totals, nothing scan-specific.
    expect(failures.every((f) => f.kind === 'totals_reconciliation')).toBe(true)
    expect(failures.some((f) => /Total Expenses/.test(f.message))).toBe(true)
  })

  it('tells a continuation page which sections were still open, so its lines stay in them', async () => {
    const page1: SyntheticPage = {
      title: 'Balance Sheet',
      titleBlock: ['Example Family Trust', 'As at 30 June 2023'],
      columns: ['2023', '2022'],
      rows: [
        { label: 'Assets' },
        { label: 'Cash', indent: 1, amounts: ['500', '400'] },
        { label: 'Total Assets', indent: 1, amounts: ['500', '400'], bold: true },
        { label: 'Liabilities' },
        { label: 'Loan - Jane Example', indent: 1, amounts: ['100', '90'] },
      ],
    }
    const page2: SyntheticPage = {
      title: 'Balance Sheet',
      titleBlock: ['Example Family Trust', 'As at 30 June 2023'],
      columns: ['2023', '2022'],
      rows: [
        { label: 'Trade Creditors', indent: 1, amounts: ['50', '60'] },
        { label: 'Total Liabilities', indent: 1, amounts: ['150', '150'], bold: true },
        { label: 'Net Assets', amounts: ['350', '250'], bold: true },
      ],
    }
    const pdf = await scannedPdf([page1, page2])
    const { reader, asked } = fakeClaude({
      1: answerFor(page1),
      // Page 2 as Claude reads it with the context: the lines before any new heading stay under "Liabilities".
      2: JSON.stringify({
          title: 'Balance Sheet',
          title_block: ['Example Family Trust', 'As at 30 June 2023'],
          columns: ['2023', '2022'],
          rows: [
            { label: 'Trade Creditors', section: ['Liabilities'], amounts: ['50', '60'], top: 0.2 },
            { label: 'Total Liabilities', section: ['Liabilities'], amounts: ['150', '150'], top: 0.23 },
            { label: 'Net Assets', section: [], amounts: ['350', '250'], top: 0.26 },
          ],
        }),
    })
    const res = (await readScannedPdf(pdf, { titles, reader, pagesAllowed: 60 }))!
    expect(asked.find((a) => a.page === 2)!.context).toMatch(/still open, outermost first: \["Liabilities"\]/)
    const st = res.read.statements[0]
    expect(st.pages).toEqual([1, 2])
    expect(st.rows.find((r) => r.label === 'Trade Creditors')!.path).toEqual(['Liabilities'])
    expect(verifyStatements(res.read.statements).filter((c) => c.status === 'mismatch' || c.status === 'wrong_column')).toEqual([])
  })

  it('reuses a page Claude has already transcribed: nothing is sent, the reading is the same', async () => {
    const pdf = await scannedPdf([profitAndLoss()])
    const reuse = { transcriptions: new Map([[1, { answer: parseScanAnswer(profitAndLossAnswer()), model: 'anthropic/claude-sonnet-5.5', generationId: 'gen-kept' }]]) }
    const never: ScanReader = {
      transcribe: async () => {
        throw new Error('Claude must not be asked again')
      },
    }
    const res = (await readScannedPdf(pdf, { titles, reader: never, pagesAllowed: 60, reuse }))!
    expect(res.transcribed).toBe(0)
    expect(res.readings.every((r) => r.reused)).toBe(true)
    expect(res.read.statements[0].rows.filter((r) => r.scan)).toHaveLength(7)
  })

  it('stops at the daily cap, and says so: the rest wait', async () => {
    const pdf = await scannedPdf([profitAndLoss(), profitAndLoss()])
    const { reader, asked } = fakeClaude({ 1: profitAndLossAnswer(), 2: profitAndLossAnswer() })
    const res = (await readScannedPdf(pdf, { titles, reader, pagesAllowed: 1 }))!
    expect(asked).toHaveLength(1)
    expect(res.unread).toEqual([2])
    expect(res.read.scan!.message).toMatch(/daily limit/)
  })

  it('says so when the reading is off: nothing is guessed', async () => {
    const pdf = await scannedPdf([profitAndLoss()])
    const res = (await readScannedPdf(pdf, { titles, reader: null, pagesAllowed: 0 }))!
    expect(res.read.statements).toEqual([])
    expect(res.unread).toEqual([1])
    expect(res.read.scan!.message).toMatch(/switched off/)
  })
})
