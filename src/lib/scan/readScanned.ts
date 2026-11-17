import { OTHER_TITLE, readStatements } from '@/lib/printed/readStatements'
import type { PrintedRead, ScanPageInfo } from '@/lib/printed/types'
import { answerToLines, continuationContext, parseScanAnswer, ScanAnswerError, type BandedLine, type ScanPageAnswer } from './claudeReader'
import { extractPageImage, openPdf, pageImageInfo, UnsupportedScanImageError, type PageImage } from './pageImages'
import { ocrTitle, type TitleReader } from './ocr'
import { ocrToLines, type BandedLine as OcrBandedLine } from './ocrLines'
import { reconcileReads } from './reconcile'
import { scannedPages } from './detect'

export { scannedPages }

/**
 * A PDF with scanned pages, read by Claude (src/lib/scan). Server-only; the
 * title reader and Claude are passed in.
 *
 *   1  a page with (almost) no text layer and a full-page image is a scan;
 *      text-layer pages keep the exact reader, never sent anywhere
 *   2  Tesseract, on our server, reads the title at the top of each scanned
 *      page: only P&L / trading statement / balance sheet pages (and an
 *      untitled page right after one) go to Claude; contents, notes, tax
 *      reconciliation, distribution, depreciation schedules (rotated pages
 *      read no title), declarations and compilation reports never leave our
 *      server, and are listed as skipped, with why
 *   3  each statement page, in order: transcribed from the full page image,
 *      every line with the section headings it sits under; a page that
 *      continues a statement is told which sections were still open
 *   4  Tesseract, on our server, reads every figure of the same statement
 *      pages: the second, independent reading (restored 18 Nov 2026)
 *   5  both readings go through the same as-printed reader as a digital PDF
 *      (periods, sections, every printed total checked to add up), and are
 *      compared figure by figure (reconcile.ts): Claude's reading is the frame
 *      (it names every line's sections); a figure both print the same is
 *      agreed, any other is for staff to choose. A scanned figure is proven
 *      only when both agree and its totals add up (printed/proof.ts)
 *
 * A page Claude has already transcribed (same file, model and prompt,
 * `reuse`) is not sent again: re-reading a scan after a reader fix
 * costs nothing and gives the same reading. At most `pagesAllowed` pages are
 * transcribed (the daily cap); past it, or when Claude is unavailable, the
 * statement pages wait, with why.
 */

/** Claude's answer to one page (askClaudeImage): the text, and who answered at what cost. */
export interface ClaudeReply {
  text: string
  model: string
  generationId: string
  tokensIn: number
  tokensOut: number
}

export interface ScanReader {
  /** The transcription, on the full page image (SCAN_PAGE_PROMPT with the continuation context). */
  transcribe: (image: PageImage, page: number, context: string) => Promise<ClaudeReply>
}

export interface KeptReading<T> {
  answer: T
  model: string
  generationId: string
}

export interface PageReading {
  page: number
  step: 'transcribe'
  /** Kept from an earlier reading: nothing was sent, nothing paid. */
  reused?: boolean
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
  /** Pages transcribed now (they count against the daily cap). */
  transcribed: number
  /** Statement pages left unread (Claude unavailable, a failed answer, or the cap). */
  unread: number[]
  model: string | null
}

export interface ScanProgress {
  stage: 'selecting' | 'reading'
  done: number
  total: number
}

export interface Reuse {
  transcriptions?: Map<number, KeptReading<ScanPageAnswer>>
}

/** One Claude call, kept as a reading; one retry when the answer does not fit the schema. */
async function ask<T>(
  page: number,
  step: PageReading['step'],
  readings: PageReading[],
  call: () => Promise<ClaudeReply>,
  parse: (text: string) => T,
): Promise<{ answer: T | null; model: string | null; error: string | null }> {
  let model: string | null = null
  for (let attempt = 0; attempt < 2; attempt++) {
    let reply: ClaudeReply
    try {
      reply = await call()
    } catch (err) {
      // The provider's error, never any page content.
      const why = err instanceof Error ? `${err.name}: ${err.message}`.slice(0, 200) : 'failed'
      readings.push({ page, step, error: why })
      return { answer: null, model, error: why }
    }
    model = reply.model
    const base = { page, step, model: reply.model, generationId: reply.generationId, tokensIn: reply.tokensIn, tokensOut: reply.tokensOut }
    try {
      const answer = parse(reply.text)
      readings.push({ ...base, answer: answer as PageReading['answer'] })
      return { answer, model, error: null }
    } catch (err) {
      readings.push({ ...base, error: err instanceof ScanAnswerError ? err.message : 'unreadable answer' })
    }
  }
  return { answer: null, model, error: 'The answer did not fit the schema twice.' }
}

export async function readScannedPdf(
  bytes: Uint8Array,
  {
    titles,
    reader,
    pagesAllowed,
    onProgress,
    reuse = {},
  }: {
    /** Tesseract's title reading, on our server: which pages are statements. */
    titles: TitleReader
    reader: ScanReader | null
    pagesAllowed: number
    onProgress?: (p: ScanProgress) => void | Promise<void>
    reuse?: Reuse
  },
): Promise<ScannedResult | null> {
  const { textPages, scanned } = await scannedPages(bytes)
  if (scanned.length === 0) return null
  const doc = await openPdf(bytes)
  const scannedSet = new Set(scanned)
  const pages: ScanPageInfo[] = textPages.map((_, i) => ({ page: i + 1, scanned: scannedSet.has(i + 1) }))
  const readings: PageReading[] = []
  const images = new Map<number, PageImage>()
  let model: string | null = null
  let failure: string | null = null

  // 2: which scanned pages are statements, from their titles read on our server.
  let previousStatement = false
  let done = 0
  const titleOf = new Map<number, string | null>()
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
    const lines = await titles.titleLines(image)
    const title = lines.map(ocrTitle).find((t): t is string => !!t)
    // An untitled page right after a statement page continues it, unless it titles itself as something else.
    const continues = previousStatement && scannedSet.has(page - 1) && lines.length > 0 && !lines.some((t) => OTHER_TITLE.test(t))
    if (title || continues) {
      Object.assign(info, { role: 'statement', note: title ?? 'Continued from the page before' })
      images.set(page, image)
      titleOf.set(page, title ?? null)
      previousStatement = true
    } else {
      Object.assign(info, { role: 'skipped', note: lines.length ? `Not a statement page ("${lines.slice(0, 2).join(' / ').slice(0, 80)}")` : 'No title could be read (a rotated or blank page)' })
      previousStatement = false
    }
  }

  // 3: the statement pages, in order, each told what the page before left open.
  const answers = new Map<number, ScanPageAnswer>()
  const linesByPage = new Map<number, BandedLine[]>()
  const unread: number[] = []
  let transcribed = 0
  const statementPages = [...images.keys()].sort((a, b) => a - b)
  done = 0
  for (const page of statementPages) {
    await onProgress?.({ stage: 'reading', done: done++, total: statementPages.length })
    // Only the page right before can be continued from.
    const before = answers.get(page - 1) ?? null
    let answer: ScanPageAnswer | null = null
    const kept = reuse.transcriptions?.get(page)
    if (kept) {
      answer = kept.answer
      model = kept.model
      readings.push({ page, step: 'transcribe', reused: true, answer: kept.answer, model: kept.model, generationId: kept.generationId })
    } else if (reader && transcribed < pagesAllowed) {
      transcribed++
      const got = await ask(page, 'transcribe', readings, () => reader.transcribe(images.get(page)!, page, continuationContext(before)), parseScanAnswer)
      answer = got.answer
      model = got.model ?? model
      failure ??= got.error
    }
    if (!answer) {
      unread.push(page)
      pages[page - 1].note = `${pages[page - 1].note ?? 'Statement page'} (not read yet)`
      continue
    }
    if (!answer.title) {
      pages[page - 1].role = 'skipped'
      pages[page - 1].note = 'Not a statement page'
    }
    answers.set(page, answer)
    linesByPage.set(page, answerToLines(answer))
  }

  // 4: Tesseract's own reading of the same statement pages, on our server.
  const ocrLinesByPage = new Map<number, OcrBandedLine[]>()
  const ocrMissing = new Set<number>()
  for (const page of linesByPage.keys()) {
    try {
      const words = await titles.readLines(images.get(page)!)
      ocrLinesByPage.set(page, withTitle(ocrToLines(words, images.get(page)!, pageImageInfo(doc, page - 1)), titleOf.get(page) ?? null))
    } catch {
      ocrMissing.add(page)
    }
  }

  // 5: both readings through the same reader as a digital PDF, then compared figure by figure.
  const readWith = (byPage: Map<number, OcrBandedLine[] | BandedLine[]>) =>
    readStatements(textPages.map((lines, i) => (scannedSet.has(i + 1) ? (byPage.get(i + 1) ?? []) : lines)))
  const read = reconcileReads({
    claude: readWith(linesByPage),
    ocr: ocrLinesByPage.size ? readWith(ocrLinesByPage) : null,
    scannedPages: scannedSet,
    ocrMissing,
    claudeLines: linesByPage,
    ocrLines: ocrLinesByPage,
  })
  const capped = reader !== null && unread.length > 0 && transcribed >= pagesAllowed
  const anyScanned = read.statements.some((s) => s.pages.some((p) => scannedSet.has(p)))
  read.scan = {
    state: unread.length && !anyScanned ? 'failed' : 'done',
    pages,
    singleReading: linesByPage.size > 0 && [...linesByPage.keys()].every((p) => ocrMissing.has(p)),
    model,
    message: unread.length
      ? `${unread.length} scanned statement page(s) could not be read yet${!reader ? ' (the reading is switched off)' : capped ? ' (the daily limit was reached)' : failure ? ` (${failure})` : ''}. Use Refresh to try again.`
      : null,
  }
  return { read, pages, readings, transcribed, unread, model }
}

/** The statement's title on the page: the full OCR may lose the title the first pass read; put it back, first. */
function withTitle(lines: OcrBandedLine[], title: string | null): OcrBandedLine[] {
  for (let i = 0; i < Math.min(lines.length, 8); i++) {
    const found = ocrTitle(lines[i].cells[0]?.text ?? '')
    if (found) {
      const out = [...lines]
      out[i] = { ...lines[i], text: found, cells: [{ ...lines[i].cells[0], text: found }] }
      return out
    }
  }
  if (!title) return lines
  return [{ text: title, cells: [{ x: 57, right: 57 + title.length * 5, text: title }], band: [0, 0] }, ...lines]
}
