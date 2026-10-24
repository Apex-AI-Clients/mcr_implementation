import { PdfTooLongError, PdfUnreadableError, readPdfPageCells } from '@/lib/pdf/pageLines'
import { readStatements } from './readStatements'
import type { PrintedRead } from './types'

/**
 * Server-only. A financial statements PDF -> its profit and loss and balance
 * sheet rows as printed (readStatements.ts). In memory, on our own server:
 * nothing is sent anywhere. A PDF without a text layer (a scan) is not
 * read at all: status 'no_text_layer', never a guess.
 */

export { PdfTooLongError, PdfUnreadableError }

/** Full reports with notes run to 20–30 pages; a bundle of years, a few times that. */
export const MAX_FINANCIALS_PAGES = 120

export async function readPrintedStatements(bytes: Uint8Array): Promise<PrintedRead> {
  const { pages } = await readPdfPageCells(bytes, MAX_FINANCIALS_PAGES)
  return readStatements(pages)
}
