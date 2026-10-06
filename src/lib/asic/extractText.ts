import { PdfTooLongError, PdfUnreadableError, groupIntoLines, readPdfPageLines } from '@/lib/pdf/pageLines'

/**
 * Server-only. PDF bytes -> text lines, top to bottom, page by page.
 *
 * The one module that touches the PDF. Everything after it (parse.ts) works on
 * plain strings, so the parsing rules are testable without a PDF at all.
 *
 * Runs entirely in memory, on our own server. The file is never written to
 * disk, never stored, and never sent anywhere — an ASIC extract carries
 * directors' dates of birth and shareholders' residential addresses, and no
 * external service (AI or otherwise) is allowed to see it. The reading itself
 * lives in lib/pdf/pageLines.ts, shared with the financials pre-pass.
 *
 * Must only be imported from API routes — never from a component.
 */

export { PdfTooLongError, PdfUnreadableError, groupIntoLines }

export interface ExtractedPdfText {
  pageCount: number
  lines: string[]
}

/**
 * A real extract runs to a handful of pages. The cap bounds the work one
 * upload can cause: 4 MB of PDF can hold thousands of pages of text.
 */
export const MAX_EXTRACT_PAGES = 60

export async function extractPdfLines(bytes: Uint8Array): Promise<ExtractedPdfText> {
  const { pageCount, pages } = await readPdfPageLines(bytes, MAX_EXTRACT_PAGES)
  return { pageCount, lines: pages.flat() }
}
