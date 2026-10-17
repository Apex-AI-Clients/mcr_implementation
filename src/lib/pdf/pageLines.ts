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

/** A page's text items, grouped into rows (top to bottom), each sorted left to right. */
function groupIntoRows(items: readonly StructuredTextItem[]): StructuredTextItem[][] {
  const words = items.filter((item) => item.str.trim() !== '')
  // PDF y grows upwards: top of the page first, then left to right.
  const sorted = [...words].sort((a, b) => b.y - a.y || a.x - b.x)

  const rows: StructuredTextItem[][] = []
  for (const item of sorted) {
    const row = rows[rows.length - 1]
    if (row && Math.abs(row[0].y - item.y) <= SAME_LINE_TOLERANCE) row.push(item)
    else rows.push([item])
  }
  for (const row of rows) row.sort((a, b) => a.x - b.x)
  return rows
}

/** True when the gap before `item` is a word break rather than a split word. */
function isWordBreak(gap: number, item: StructuredTextItem): boolean {
  // A gap wider than a sliver of a character is a word break. pdf.js
  // sometimes splits one word into several items with no gap at all.
  return gap > Math.max(item.fontSize, 1) * 0.15
}

export function groupIntoLines(items: readonly StructuredTextItem[]): string[] {
  return groupIntoRows(items)
    .map((row) => {
      let line = ''
      let end = -Infinity
      for (const item of row) {
        const joiner = line && isWordBreak(item.x - end, item) ? ' ' : ''
        line += joiner + item.str
        end = item.x + item.width
      }
      return line.replace(/\s+/g, ' ').trim()
    })
    .filter(Boolean)
}

/** A run of text on one line, with where it sits on the page (PDF points). */
export interface PdfCell {
  /** Left edge. */
  x: number
  /** Right edge. Right-aligned figures line up on this, not on `x`. */
  right: number
  text: string
}

export interface PdfLine {
  /** The whole line, as groupIntoLines would give it. */
  text: string
  /** The line split where the gap is wider than a space: label, value, column. */
  cells: PdfCell[]
}

/**
 * Items further apart than this many character heights start a new cell. A
 * space is a fraction of one; the gap between a label and its value, or
 * between two table columns, is several.
 */
const CELL_GAP_EMS = 1

/**
 * Like groupIntoLines, but keeps the cells and their positions, for layouts
 * where position carries meaning: a table's columns, or a form's label and
 * value printed beside an unrelated column on the same baseline.
 */
export function groupIntoCells(items: readonly StructuredTextItem[]): PdfLine[] {
  return groupIntoRows(items)
    .map((row) => {
      const cells: PdfCell[] = []
      let current: PdfCell | null = null
      for (const item of row) {
        const gap = current ? item.x - current.right : Infinity
        if (current && gap <= Math.max(item.fontSize, 1) * CELL_GAP_EMS) {
          current.text += (isWordBreak(gap, item) ? ' ' : '') + item.str
          current.right = Math.max(current.right, item.x + item.width)
        } else {
          current = { x: item.x, right: item.x + item.width, text: item.str }
          cells.push(current)
        }
      }
      const tidy = cells
        .map((cell) => ({ ...cell, text: cell.text.replace(/\s+/g, ' ').trim() }))
        .filter((cell) => cell.text !== '')
      return { text: tidy.map((cell) => cell.text).join(' '), cells: tidy }
    })
    .filter((line) => line.cells.length > 0)
}

function isPasswordError(err: unknown): boolean {
  return err instanceof Error && err.name === 'PasswordException'
}

/** Open the PDF, read every page's text items, and always close it again. */
async function readPdfItems(
  bytes: Uint8Array,
  maxPages: number,
): Promise<{ totalPages: number; items: StructuredTextItem[][] }> {
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>
  try {
    // A copy: pdf.js may take ownership of (detach) the buffer it is given.
    pdf = await getDocumentProxy(new Uint8Array(bytes), LOCAL_ONLY)
  } catch (err) {
    throw new PdfUnreadableError(isPasswordError(err))
  }

  try {
    if (pdf.numPages > maxPages) throw new PdfTooLongError(pdf.numPages)
    return await extractTextItems(pdf)
  } catch (err) {
    if (err instanceof PdfTooLongError) throw err
    throw new PdfUnreadableError(isPasswordError(err))
  } finally {
    // What unpdf's own helpers do; this pdf.js build's proxy has no destroy().
    await pdf.loadingTask.destroy().catch(() => {})
  }
}

export async function readPdfPageLines(bytes: Uint8Array, maxPages: number): Promise<PdfPageLines> {
  const { totalPages, items } = await readPdfItems(bytes, maxPages)
  return { pageCount: totalPages, pages: items.map(groupIntoLines) }
}

export interface PdfPageCells {
  pageCount: number
  /** One entry per page, in file order; each is that page's lines with their cells. */
  pages: PdfLine[][]
}

export async function readPdfPageCells(bytes: Uint8Array, maxPages: number): Promise<PdfPageCells> {
  const { totalPages, items } = await readPdfItems(bytes, maxPages)
  return { pageCount: totalPages, pages: items.map(groupIntoCells) }
}
