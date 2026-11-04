import type { PdfLine } from '@/lib/pdf/pageLines'
import { readPdfPageCells } from '@/lib/pdf/pageLines'
import { MAX_FINANCIALS_PAGES } from '@/lib/printed/readPdf'
import { OTHER_TITLE, readStatements, statementKind } from '@/lib/printed/readStatements'
import type { PrintedRead, ScanPageInfo } from '@/lib/printed/types'
import { answerToLines, parseScanAnswer, ScanAnswerError, type ScanPageAnswer } from './claudeReader'
import { ocrToLines, type BandedLine, type OcrLine } from './ocrLines'
import type { OcrEngine } from './ocr'
import { extractPageImage, openPdf, pageImageInfo, UnsupportedScanImageError, type PageImage } from './pageImages'
import { reconcileReads } from './reconcile'

/**
 * A PDF with scanned pages, read twice, independently, and reconciled
 * (reconcile.ts). Server-only; the engines are passed in.
 *
 *   B1  a page with (almost) no text layer and a full-page image is a scan;
 *       text-layer pages keep the exact reader, never OCR
 *   B2  a cheap Tesseract pass over each scan's top third reads its title:
 *       only P&L / trading / balance sheet pages (and an untitled page right
 *       after one) go further; contents, notes, tax reconciliation,
 *       depreciation schedules (rotated pages read no title), declarations and
 *       compilation reports are skipped, with why
 *   B3  each statement page: Tesseract's words, and Claude's transcription of
 *       the page image, each through the same as-printed reader
 *   B8  Claude reads at most `secondPagesAllowed` pages (the daily cap); the
 *       rest, or every page when Claude is unavailable, are single readings
 */

/**
 * A statement title as OCR reads it ("Profit Loss Statement cL oN",
 * "Profit & Loss Statement.", "Balance Sheet CLM"): the longest run of
 * words from the start that is a P&L or balance sheet title, the "&" put back.
 * Null when there is none.
 */
export function ocrTitle(text: string): string | null {
  const words = text
    .replace(/[.:]+$/g, '')
    .split(/\s+/)
    .map((w) => w.replace(/[.:,]+$/, ''))
    .filter(Boolean)
  let best: string | null = null
  for (let n = 1; n <= Math.min(words.length, 12); n++) {
    const candidate = words
      .slice(0, n)
      .join(' ')
      .replace(/\bprofit\s+loss\b/i, (m) => m.replace(/\s+/, ' & '))
    // A title is the line (a logo scrap or two beside it at most), capitalised: never a sentence that starts "balance sheet…".
    if (statementKind(candidate) && words.length - n <= 2 && /^[A-Z]/.test(candidate)) best = candidate
  }
  // The longest: "Profit & Loss Statement", not "Profit & Loss".
  return best
}

/** The page's title line, as the reader expects it: one cell, as printed (the logo beside it left out). */
function withTitle(lines: BandedLine[], title: string | null): BandedLine[] {
  for (let i = 0; i < Math.min(lines.length, 8); i++) {
    const found = ocrTitle(lines[i].cells[0]?.text ?? '')
    if (found) {
      const out = [...lines]
      out[i] = { ...lines[i], text: found, cells: [{ ...lines[i].cells[0], text: found }] }
      return out
    }
  }
  // The full read dropped a title the first pass read: put it back, first.
  if (!title) return lines
  return [{ text: title, cells: [{ x: 57, right: 57 + title.length * 5, text: title }], band: [0, 0] }, ...lines]
}

/** Fewer text characters than this and a full-page image: a scan. */
const SCANNED_MAX_TEXT = 20

export interface SecondReading {
  answer: ScanPageAnswer
  model: string
  generationId: string
  tokensIn: number
  tokensOut: number
}

/** Claude's transcription of one page image (askClaudeImage + SCAN_PAGE_PROMPT); null when unavailable. */
export type SecondReader = ((image: PageImage, page: number) => Promise<{ text: string; model: string; generationId: string; tokensIn: number; tokensOut: number }>) | null

export interface PageReading {
  page: number
  reader: 'tesseract' | 'claude'
  lines?: BandedLine[]
  answer?: ScanPageAnswer
  model?: string
  generationId?: string
  tokensIn?: number
  tokensOut?: number
  error?: string
}

export interface ScannedResult {
  read: PrintedRead
  pages: ScanPageInfo[]
  readings: PageReading[]
  /** Pages Claude was asked to read (they count against the cap, success or not). */
  secondPages: number
  singleReading: boolean
  model: string | null
}

export interface ScanProgress {
  stage: 'selecting' | 'reading'
  done: number
  total: number
}

/** Pages that are scans (1-based), from the text layer and the images. Cheap: no OCR. */
export async function scannedPages(bytes: Uint8Array): Promise<{ textPages: PdfLine[][]; scanned: number[] }> {
  const { pages: textPages } = await readPdfPageCells(bytes, MAX_FINANCIALS_PAGES)
  const doc = await openPdf(bytes)
  const scanned: number[] = []
  textPages.forEach((lines, i) => {
    const chars = lines.reduce((n, l) => n + l.text.replace(/\s/g, '').length, 0)
    if (chars >= SCANNED_MAX_TEXT) return
    if (pageImageInfo(doc, i).image?.fullPage) scanned.push(i + 1)
  })
  return { textPages, scanned }
}

export async function readScannedPdf(
  bytes: Uint8Array,
  {
    ocr,
    second,
    secondPagesAllowed,
    onProgress,
  }: { ocr: OcrEngine; second: SecondReader; secondPagesAllowed: number; onProgress?: (p: ScanProgress) => void | Promise<void> },
): Promise<ScannedResult | null> {
  const { textPages, scanned } = await scannedPages(bytes)
  if (scanned.length === 0) return null
  const doc = await openPdf(bytes)
  const scannedSet = new Set(scanned)
  const pages: ScanPageInfo[] = textPages.map((_, i) => ({ page: i + 1, scanned: scannedSet.has(i + 1) }))
  const images = new Map<number, PageImage>()
  const titleOf = new Map<number, string | null>()

  // B2: titles first, cheaply.
  let previousStatement = false
  let done = 0
  for (const page of scanned) {
    await onProgress?.({ stage: 'selecting', done: done++, total: scanned.length })
    const info = pages[page - 1]
    let image: PageImage
    try {
      image = await extractPageImage(doc, page - 1)
    } catch (err) {
      Object.assign(info, { role: 'skipped', note: err instanceof UnsupportedScanImageError ? err.message : 'The page image could not be read.' })
      previousStatement = false
      continue
    }
    const titles = await ocr.titleLines(image)
    const title = titles.map(ocrTitle).find((t): t is string => !!t)
    const continues = previousStatement && scannedSet.has(page - 1) && !titles.some((t) => OTHER_TITLE.test(t)) && titles.length > 0
    if (title || continues) {
      images.set(page, image)
      Object.assign(info, { role: 'statement', note: title ?? 'Continued from the page before' })
      titleOf.set(page, title ?? null)
      previousStatement = true
    } else {
      Object.assign(info, { role: 'skipped', note: titles.length ? `Not a statement page ("${titles.slice(0, 2).join(' / ').slice(0, 80)}")` : 'No title could be read (a rotated or blank page)' })
      previousStatement = false
    }
  }

  // B3: two readings of each statement page.
  const readings: PageReading[] = []
  const ocrLinesByPage = new Map<number, BandedLine[]>()
  const claudeLinesByPage = new Map<number, BandedLine[]>()
  const secondMissing = new Set<number>()
  let secondPages = 0
  let secondError: string | null = null
  let model: string | null = null
  const statementPages = [...images.keys()]
  done = 0
  for (const page of statementPages) {
    await onProgress?.({ stage: 'reading', done: done++, total: statementPages.length })
    const image = images.get(page)!
    const size = pageImageInfo(doc, page - 1)
    const words: OcrLine[] = await ocr.readLines(image)
    const lines = withTitle(ocrToLines(words, image, size), titleOf.get(page) ?? null)
    ocrLinesByPage.set(page, lines)
    readings.push({ page, reader: 'tesseract', lines })

    if (!second || secondPages >= secondPagesAllowed) {
      secondMissing.add(page)
      continue
    }
    secondPages++
    let answer: ScanPageAnswer | null = null
    for (let attempt = 0; attempt < 2 && !answer; attempt++) {
      try {
        const reply = await second(image, page)
        model = reply.model
        try {
          answer = parseScanAnswer(reply.text)
          readings.push({ page, reader: 'claude', answer, model: reply.model, generationId: reply.generationId, tokensIn: reply.tokensIn, tokensOut: reply.tokensOut })
        } catch (err) {
          readings.push({ page, reader: 'claude', model: reply.model, generationId: reply.generationId, tokensIn: reply.tokensIn, tokensOut: reply.tokensOut, error: err instanceof ScanAnswerError ? err.message : 'unreadable answer' })
        }
      } catch (err) {
        // The provider's error (e.g. no zero-retention endpoint), never any page content.
        const why = err instanceof Error ? `${err.name}: ${err.message}`.slice(0, 200) : 'failed'
        readings.push({ page, reader: 'claude', error: why })
        secondError = why
        break
      }
    }
    if (answer) claudeLinesByPage.set(page, answerToLines(answer))
    else secondMissing.add(page)
  }

  const pagesFor = (scannedLines: Map<number, BandedLine[]>) => textPages.map((lines, i) => (scannedSet.has(i + 1) ? (scannedLines.get(i + 1) ?? []) : lines))
  const ocrRead = readStatements(pagesFor(ocrLinesByPage))
  const anySecond = claudeLinesByPage.size > 0
  const claudeRead = anySecond ? readStatements(pagesFor(claudeLinesByPage)) : null
  const read = reconcileReads({ ocr: ocrRead, claude: claudeRead, scannedPages: scannedSet, secondMissing, ocrLines: ocrLinesByPage, claudeLines: claudeLinesByPage })
  const singleReading = statementPages.length > 0 && statementPages.every((p) => secondMissing.has(p))
  read.scan = {
    state: 'done',
    pages,
    singleReading,
    model,
    message: singleReading
      ? `Read from a scan by one reader only: check every figure.${secondError ? ' The second reading was unavailable.' : ''}`
      : secondMissing.size
        ? `${secondMissing.size} scanned page(s) were read by one reader only: check their figures.`
        : null,
  }
  return { read, pages, readings, secondPages, singleReading, model }
}
