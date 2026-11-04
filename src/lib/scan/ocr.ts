import path from 'node:path'
import os from 'node:os'
import sharp from 'sharp'
import { createWorker, type Worker } from 'tesseract.js'
import type { OcrLine } from './ocrLines'
import type { PageImage } from './pageImages'

/**
 * Server-only. Tesseract (tesseract.js, open source, WebAssembly) on our own
 * server: the first reading of a scanned page. The English model ships with
 * the app (@tesseract.js-data/eng), so nothing is downloaded or sent anywhere.
 * Never used on a text-layer page.
 */

export interface OcrEngine {
  /** The page's top third, cheaply: enough to read its title. */
  titleLines(image: PageImage): Promise<string[]>
  /** Every word on the page, with its position (image pixels), line by line. */
  readLines(image: PageImage): Promise<OcrLine[]>
  close(): Promise<void>
}

const LANG_PATH = path.join(process.cwd(), 'node_modules', '@tesseract.js-data', 'eng', '4.0.0_best_int')

export async function tesseractEngine(): Promise<OcrEngine> {
  const worker: Worker = await createWorker('eng', 1, {
    langPath: LANG_PATH,
    gzip: true,
    cachePath: path.join(os.tmpdir(), 'mcr-tesseract'),
  })
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
    async readLines(image) {
      const { data } = await worker.recognize(Buffer.from(image.bytes), {}, { blocks: true })
      return (data.blocks ?? []).flatMap((b) =>
        b.paragraphs.flatMap((p) =>
          p.lines.map((l) => ({
            words: l.words.map((w) => ({ text: w.text, confidence: w.confidence, x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 })),
          })),
        ),
      )
    },
    async close() {
      await worker.terminate()
    },
  }
}
