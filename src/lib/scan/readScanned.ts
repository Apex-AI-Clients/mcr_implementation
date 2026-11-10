import { OTHER_TITLE, readStatements } from '@/lib/printed/readStatements'
import type { PrintedRead, PrintedRow, ScanPageInfo } from '@/lib/printed/types'
import { answerToLines, continuationContext, parseScanAnswer, ScanAnswerError, type BandedLine, type ScanPageAnswer } from './claudeReader'
import { extractPageImage, openPdf, UnsupportedScanImageError, type PageImage } from './pageImages'
import { ocrTitle, type TitleReader } from './ocr'
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
 *   4  the transcriptions go through the same as-printed reader as a digital
 *      PDF (periods, sections, every printed total checked to add up), and
 *      are accepted as read: a total that does not add up is flagged as for
 *      any statement
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

  // 4: the same reader as a digital PDF; each scanned line keeps its reading and its place on the page.
  const read = readStatements(textPages.map((lines, i) => (scannedSet.has(i + 1) ? (linesByPage.get(i + 1) ?? []) : lines)))
  markScanned(read, scannedSet, linesByPage)
  const capped = reader !== null && unread.length > 0 && transcribed >= pagesAllowed
  const anyScanned = read.statements.some((s) => s.pages.some((p) => scannedSet.has(p)))
  read.scan = {
    state: unread.length && !anyScanned ? 'failed' : 'done',
    pages,
    singleReading: false,
    model,
    message: unread.length
      ? `${unread.length} scanned statement page(s) could not be read yet${!reader ? ' (the reading is switched off)' : capped ? ' (the daily limit was reached)' : failure ? ` (${failure})` : ''}. Use Refresh to try again.`
      : null,
  }
  return { read, pages, readings, transcribed, unread, model }
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/** Each line read from a scanned page: its reading (accepted), the key a staff correction is kept under, and its band for the crop. */
function markScanned(read: PrintedRead, scanned: Set<number>, linesByPage: Map<number, BandedLine[]>) {
  const seen = new Map<string, number>()
  for (const st of read.statements) {
    st.rows = st.rows.map((row): PrintedRow => {
      if (!scanned.has(row.page) || row.style === 'heading') return row
      const base = `${st.kind}|${row.page}|${row.path.map(norm).join('>')}|${norm(row.label)}`
      const n = seen.get(base) ?? 0
      seen.set(base, n + 1)
      const line = linesByPage.get(row.page)?.find((l) => l.text === row.text)
      return {
        ...row,
        scan: {
          key: `${base}|${n}`,
          band: line && line.band[1] > 0 ? line.band : null,
          cells: row.amounts.map((a) => ({ status: 'read' as const, claude: a })),
        },
      }
    })
  }
}
