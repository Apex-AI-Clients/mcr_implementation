// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildPrintedComparison } from '@/lib/printed/compare'
import { printedExportsLocked } from '@/lib/printed/review'
import { verifyStatements } from '@/lib/printed/verify'
import { tesseractEngine, type OcrEngine } from '../ocr'
import { readScannedPdf, scannedPages, type SecondReader } from '../readScanned'
import { applyScanChoices } from '../choices'
import { profitAndLoss, profitAndLossAnswer, scannedPdf } from './fixtures'

/**
 * Scanned statements read twice: synthetic image PDFs, Tesseract for real (on
 * this machine), Claude replaced by a fixed transcription. No real client
 * data, no network.
 */

let ocr: OcrEngine
beforeAll(async () => {
  ocr = await tesseractEngine()
}, 60_000)
afterAll(async () => {
  await ocr?.close()
})

const claudeSays = (text: string): NonNullable<SecondReader> => async () => ({ text, model: 'anthropic/claude-sonnet-5.5', generationId: 'gen-test', tokensIn: 5000, tokensOut: 3000 })
const cover = { text: ['Example Family Trust', 'Financial Statements', 'For the year ended 30 June 2023'] }
const notes = { title: 'Notes to the Financial Statements', text: ['1. Summary of significant accounting policies', 'The trust is a non-reporting entity.'] }

const doc = (read: Awaited<ReturnType<typeof readScannedPdf>>) => [{ documentId: 'fy23', filename: 'fy23.pdf', uploadedAt: '', read: read!.read }]

describe('scanned statements', () => {
  it('finds the scanned pages, page by page: a text-layer page is never OCR', async () => {
    const pdf = await scannedPdf([cover, profitAndLoss()], { textPages: new Map([[0, ['Example Family Trust', 'Financial Statements for the year ended 30 June 2023']]]) })
    const { scanned } = await scannedPages(pdf)
    expect(scanned).toEqual([2])
  })

  it('reads only the statement pages: the cover and notes are skipped, with why', async () => {
    const pdf = await scannedPdf([cover, profitAndLoss(), notes])
    const res = await readScannedPdf(pdf, { ocr, second: null, secondPagesAllowed: 0 })
    expect(res!.pages.map((p) => [p.page, p.role])).toEqual([
      [1, 'skipped'],
      [2, 'statement'],
      [3, 'skipped'],
    ])
    expect(res!.readings.map((r) => r.page)).toEqual([2])
    // No second reading: every figure is a single reading.
    expect(res!.singleReading).toBe(true)
    const st = res!.read.statements[0]
    expect(st.columns.map((c) => c.financialYear)).toEqual([2023, 2022])
    expect(st.rows.filter((r) => r.scan).every((r) => r.scan!.cells.every((c) => c.status === 'single'))).toBe(true)
    const failures = buildPrintedComparison(doc(res)).failures
    // FY2023 (FY2022 is only this report's comparative column, hidden by default).
    expect(failures.map((f) => [f.kind, f.financialYear])).toEqual([['scan_single_reading', 2023]])
  }, 120_000)

  it('accepts every figure both readers agree on, and every printed total adds up', async () => {
    const pdf = await scannedPdf([profitAndLoss()])
    const res = await readScannedPdf(pdf, { ocr, second: claudeSays(profitAndLossAnswer()), secondPagesAllowed: 60 })
    const rows = res!.read.statements[0].rows.filter((r) => r.scan)
    expect(rows.map((r) => r.label)).toEqual(['Sales', 'Interest Income', 'Total Income', 'Rent', 'Wages', 'Total Expenses', 'Net Profit'])
    expect(rows.flatMap((r) => r.scan!.cells.map((c) => c.status)).every((s) => s === 'agree')).toBe(true)
    expect(rows.find((r) => r.label === 'Interest Income')!.amounts).toEqual([600, null])
    expect(verifyStatements(res!.read.statements).filter((c) => c.status === 'mismatch' || c.status === 'wrong_column')).toEqual([])
    expect(buildPrintedComparison(doc(res)).failures).toEqual([])
  }, 120_000)

  it('highlights a figure the readers disagree on until staff choose it', async () => {
    const pdf = await scannedPdf([profitAndLoss()])
    const res = await readScannedPdf(pdf, { ocr, second: claudeSays(profitAndLossAnswer({ change: { label: 'Rent', column: 0, to: '24,800' } })), secondPagesAllowed: 60 })
    const rent = res!.read.statements[0].rows.find((r) => r.label === 'Rent')!
    expect(rent.scan!.cells[0]).toMatchObject({ status: 'disagree', ocr: 24000, claude: 24800 })
    expect(rent.scan!.band).not.toBeNull()
    const comparison = buildPrintedComparison(doc(res))
    expect(comparison.failures.filter((f) => f.kind === 'scan_disagreement')).toHaveLength(1)
    // The tick does not settle it.
    expect(printedExportsLocked(comparison, '2026-11-04T00:00:00Z', { fingerprint: 'anything', by: 'Staff', at: '2026-11-04T00:00:00Z' })).toBe(true)

    const chosen = applyScanChoices(res!.read, [{ rowKey: rent.scan!.key, column: 0, source: 'tesseract', value: 24000, chosenBy: 'Test Staff', chosenAt: '2026-11-04T01:00:00Z' }])
    const after = buildPrintedComparison([{ ...doc(res)[0], read: chosen }])
    expect(after.failures).toEqual([])
    const cell = after.tables[0].rows.find((r) => r.label === 'Rent')!.cells.find((c) => c.scan)!
    expect(cell).toMatchObject({ value: 24000, scan: { status: 'chosen', chosenBy: 'Test Staff' } })
  }, 120_000)

  it('reports a printed total that does not add up, as for any statement', async () => {
    const wrong = profitAndLoss({ wrongTotal: true })
    const pdf = await scannedPdf([wrong])
    const answer = profitAndLossAnswer({ change: { label: 'Total Expenses', column: 0, to: '86,500' } })
    const res = await readScannedPdf(pdf, { ocr, second: claudeSays(answer), secondPagesAllowed: 60 })
    const failures = buildPrintedComparison(doc(res)).failures
    expect(failures.some((f) => f.kind === 'totals_reconciliation' && /Total Expenses/.test(f.message))).toBe(true)
    expect(failures.some((f) => f.kind === 'scan_disagreement')).toBe(false)
  }, 120_000)

  it('stops asking Claude at the daily cap: the rest are single readings', async () => {
    const pdf = await scannedPdf([profitAndLoss(), profitAndLoss()])
    let asked = 0
    const second: SecondReader = async (...args) => {
      asked++
      return claudeSays(profitAndLossAnswer())(...args)
    }
    const res = await readScannedPdf(pdf, { ocr, second, secondPagesAllowed: 1 })
    expect(asked).toBe(1)
    expect(res!.secondPages).toBe(1)
    expect(res!.read.scan!.message).toMatch(/one reader only/)
  }, 120_000)
})
