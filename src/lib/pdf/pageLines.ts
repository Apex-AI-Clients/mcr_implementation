import { extractTextItems, getDocumentProxy, type StructuredTextItem } from 'unpdf'

/**
 * Server-only. PDF bytes -> text lines, page by page, top to bottom.
 *
 * Shared by the ASIC extract reader and the financials pre-pass. Runs entirely
 * in memory, on our own server: the file is never written to disk, never
 * stored, and never sent anywhere.
 *
 * unpdf wraps Mozilla's pdf.js in a serverless build with no worker. pdf.js
 * only fetches when it is handed a URL — a document URL, or the font, CMap and
 * WASM locations — so none are given, and the ones unpdf would resolve from a
 * local pdfjs-dist are overridden. Text extraction needs none of them.
 *
 * Encrypted PDFs that open without a password (signed accountant PDFs: an
 * owner password restricts editing, not reading) are read like any other.
 * pdf.js does not apply the copy/extract permission flags to text extraction.
 *
 * Must only be imported from server code — never from a component.
 */

/** The PDF could not be opened at all: damaged, password-protected, or not a PDF. */
export class PdfUnreadableError extends Error {
  constructor(readonly passwordProtected = false) {
    super(passwordProtected ? 'PDF needs a password to open' : 'PDF could not be opened')
    this.name = 'PdfUnreadableError'
  }
}

/** More pages than the caller allows. Refused before any text is read. */
export class PdfTooLongError extends Error {
  constructor(readonly pageCount: number) {
    super('PDF has too many pages')
    this.name = 'PdfTooLongError'
  }
}

export interface PdfPageLines {
  pageCount: number
  /** One entry per page, in file order; each is that page's lines. */
  pages: string[][]
}

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
 * Items whose baselines are this close (in PDF points) share a line. Forms and
 * statements print a label and its values in separate columns on one
 * baseline, and they read as one line.
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

function isPasswordError(err: unknown): boolean {
  return err instanceof Error && err.name === 'PasswordException'
}

export async function readPdfPageLines(bytes: Uint8Array, maxPages: number): Promise<PdfPageLines> {
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>
  try {
    // A copy: pdf.js may take ownership of (detach) the buffer it is given.
    pdf = await getDocumentProxy(new Uint8Array(bytes), LOCAL_ONLY)
  } catch (err) {
    throw new PdfUnreadableError(isPasswordError(err))
  }

  try {
    if (pdf.numPages > maxPages) throw new PdfTooLongError(pdf.numPages)
    const { totalPages, items } = await extractTextItems(pdf)
    return { pageCount: totalPages, pages: items.map(groupIntoLines) }
  } catch (err) {
    if (err instanceof PdfTooLongError) throw err
    throw new PdfUnreadableError(isPasswordError(err))
  } finally {
    // What unpdf's own helpers do; this pdf.js build's proxy has no destroy().
    await pdf.loadingTask.destroy().catch(() => {})
  }
}
