import { extractTextItems, getDocumentProxy, type StructuredTextItem } from 'unpdf'

/**
 * Server-only. PDF bytes -> text lines, top to bottom, page by page.
 *
 * The one module that touches the PDF. Everything after it (parse.ts) works on
 * plain strings, so the parsing rules are testable without a PDF at all.
 *
 * Runs entirely in memory, on our own server. The file is never written to
 * disk, never stored, and never sent anywhere — an ASIC extract carries
 * directors' dates of birth and shareholders' residential addresses, and no
 * external service (AI or otherwise) is allowed to see it.
 *
 * unpdf wraps Mozilla's pdf.js in a serverless build with no worker. pdf.js
 * only fetches when it is handed a URL — a document URL, or the font, CMap and
 * WASM locations — so none are given, and the ones unpdf would resolve from a
 * local pdfjs-dist are overridden. Text extraction needs none of them.
 *
 * Must only be imported from API routes — never from a component.
 */

export interface ExtractedPdfText {
  pageCount: number
  lines: string[]
}

/** The PDF could not be opened at all: damaged, encrypted, or not a PDF. */
export class PdfUnreadableError extends Error {
  constructor() {
    super('PDF could not be opened')
    this.name = 'PdfUnreadableError'
  }
}

/** More pages than a company extract could have. Refused before any text is read. */
export class PdfTooLongError extends Error {
  constructor(readonly pageCount: number) {
    super('PDF has too many pages')
    this.name = 'PdfTooLongError'
  }
}

/**
 * A real extract runs to a handful of pages. The cap bounds the work one
 * upload can cause: 4 MB of PDF can hold thousands of pages of text.
 */
export const MAX_EXTRACT_PAGES = 60

/** Options that keep pdf.js to the bytes it was given. */
const LOCAL_ONLY = {
  isEvalSupported: false,
  useSystemFonts: false,
  disableFontFace: true,
  standardFontDataUrl: undefined,
  cMapUrl: undefined,
  wasmUrl: undefined,
  iccUrl: undefined,
  stopAtErrors: false,
  verbosity: 0,
} as const

/**
 * Items whose baselines are this close (in PDF points) share a line. ASIC
 * prints a label, its value and a document number in separate columns on one
 * baseline — "Name:" … "JANE SAMPLE" … "7EBH40554" — and they read as one line.
 */
const SAME_LINE_TOLERANCE = 2

export function groupIntoLines(items: readonly StructuredTextItem[]): string[] {
  const words = items.filter((item) => item.str.trim() !== '')
  // PDF y grows upwards: top of the page first, then left to right.
  const sorted = [...words].sort((a, b) => b.y - a.y || a.x - b.x)

  const rows: StructuredTextItem[][] = []
  for (const item of sorted) {
    const row = rows[rows.length - 1]
    if (row && Math.abs(row[0].y - item.y) <= SAME_LINE_TOLERANCE) row.push(item)
    else rows.push([item])
  }

  return rows.map((row) => {
    row.sort((a, b) => a.x - b.x)
    let line = ''
    let end = -Infinity
    for (const item of row) {
      // A gap wider than a sliver of a character is a word break. pdf.js
      // sometimes splits one word into several items with no gap at all.
      const gap = item.x - end
      const joiner = line && gap > Math.max(item.fontSize, 1) * 0.15 ? ' ' : ''
      line += joiner + item.str
      end = item.x + item.width
    }
    return line.replace(/\s+/g, ' ').trim()
  }).filter(Boolean)
}

export async function extractPdfLines(bytes: Uint8Array): Promise<ExtractedPdfText> {
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>
  try {
    // A copy: pdf.js may take ownership of (detach) the buffer it is given.
    pdf = await getDocumentProxy(new Uint8Array(bytes), LOCAL_ONLY)
  } catch {
    throw new PdfUnreadableError()
  }

  try {
    if (pdf.numPages > MAX_EXTRACT_PAGES) throw new PdfTooLongError(pdf.numPages)
    const { totalPages, items } = await extractTextItems(pdf)
    return { pageCount: totalPages, lines: items.flatMap(groupIntoLines) }
  } catch (err) {
    if (err instanceof PdfTooLongError) throw err
    throw new PdfUnreadableError()
  } finally {
    // What unpdf's own helpers do; this pdf.js build's proxy has no destroy().
    await pdf.loadingTask.destroy().catch(() => {})
  }
}
