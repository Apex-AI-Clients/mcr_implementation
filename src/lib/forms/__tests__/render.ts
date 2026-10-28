import { getDocumentProxy, renderPageAsImage } from 'unpdf'
import { PNG } from 'pngjs'
import pixelmatch from 'pixelmatch'

/**
 * Test helpers: a PDF's pages as PNG images (pdf.js via unpdf, drawn on
 * @napi-rs/canvas), and a pixel comparison of two images. Used by the forms
 * render tests only; nothing here runs in the app.
 */

export const RENDER_SCALE = 1.5

export async function renderPages(pdf: Uint8Array, pages?: number[], scale = RENDER_SCALE): Promise<Buffer[]> {
  const doc = await getDocumentProxy(new Uint8Array(pdf))
  const list = pages ?? Array.from({ length: doc.numPages }, (_, i) => i + 1)
  const out: Buffer[] = []
  for (const p of list) {
    const png = await renderPageAsImage(doc, p, { canvasImport: () => import('@napi-rs/canvas'), scale })
    out.push(Buffer.from(png))
  }
  return out
}

export interface PixelDiff {
  /** Pixels that differ beyond pixelmatch's anti-aliasing tolerance. */
  differing: number
  sameSize: boolean
  diffPng?: Buffer
}

export function comparePngs(a: Buffer, b: Buffer, threshold = 0): PixelDiff {
  const A = PNG.sync.read(a)
  const B = PNG.sync.read(b)
  if (A.width !== B.width || A.height !== B.height) return { differing: Number.POSITIVE_INFINITY, sameSize: false }
  const diff = new PNG({ width: A.width, height: A.height })
  const differing = pixelmatch(A.data, B.data, diff.data, A.width, A.height, { threshold })
  return { differing, sameSize: true, diffPng: differing ? PNG.sync.write(diff) : undefined }
}
