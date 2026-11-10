import path from 'node:path'
import os from 'node:os'
import sharp from 'sharp'
import { createWorker, type Worker } from 'tesseract.js'
import { statementKind } from '@/lib/printed/readStatements'
import type { PageImage } from './pageImages'

/**
 * Server-only. Tesseract (tesseract.js, open source, WebAssembly) on our own
 * server, for ONE job: reading the title at the top of each scanned page, so
 * only the statement pages are sent to Claude (CLAUDE.md rule 12: no other
 * scanned page ever leaves our server). It reads no figure. The English model
 * ships with the app (@tesseract.js-data/eng), so nothing is downloaded or
 * sent anywhere. Never used on a text-layer page.
 */

export interface TitleReader {
  /** The page's top third, cheaply: its title lines. */
  titleLines(image: PageImage): Promise<string[]>
  close(): Promise<void>
}

const LANG_PATH = path.join(process.cwd(), 'node_modules', '@tesseract.js-data', 'eng', '4.0.0_best_int')
/**
 * tesseract.js finds its background worker relative to its own files; inside
 * Next.js those can be moved, and the worker then never starts (no error, it
 * just waits). Given by an explicit path, as the language model is.
 */
const WORKER_PATH = path.join(process.cwd(), 'node_modules', 'tesseract.js', 'src', 'worker-script', 'node', 'index.js')
/** Starting takes about a second; past this, it is not going to. */
const START_LIMIT_MS = 45_000

export class TitleReaderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TitleReaderError'
  }
}

export async function tesseractTitles(): Promise<TitleReader> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TitleReaderError('The page reader (Tesseract) did not start.')), START_LIMIT_MS)
  })
  let worker: Worker
  try {
    worker = await Promise.race([
      createWorker('eng', 1, {
        langPath: LANG_PATH,
        workerPath: WORKER_PATH,
        gzip: true,
        cachePath: path.join(os.tmpdir(), 'mcr-tesseract'),
      }),
      limit,
    ])
  } catch (err) {
    throw err instanceof TitleReaderError ? err : new TitleReaderError(`The page reader (Tesseract) could not start: ${err instanceof Error ? err.message : String(err)}`.slice(0, 200))
  } finally {
    clearTimeout(timer)
  }
  return {
    async titleLines(image) {
      const top = await sharp(image.bytes)
        .extract({ left: 0, top: 0, width: image.width, height: Math.round(image.height * 0.32) })
        .resize({ width: Math.min(1000, image.width) })
        .greyscale()
        .png()
        .toBuffer()
      const { data } = await worker.recognize(top)
      return data.text
        .split('\n')
        .map((l) => l.replace(/\s+/g, ' ').trim())
        .filter(Boolean)
    },
    async close() {
      await worker.terminate()
    },
  }
}

/**
 * A statement title as OCR reads it ("Profit Loss Statement cL oN",
 * "Profit & Loss Statement.", "Balance Sheet CLM"): the longest run of words
 * from the start that is a P&L or balance sheet title, the "&" put back.
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
