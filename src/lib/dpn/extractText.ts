import { PdfTooLongError, PdfUnreadableError, readPdfPageCells } from '@/lib/pdf/pageLines'
import { parseDirectorPenaltyNotice } from './parse'
import type { DpnParseResult } from './types'

/**
 * Server-only. A director penalty notice PDF -> the parsed notice.
 *
 * Runs entirely in memory, on our own server: the file is never written to
 * disk and its text is never stored, logged, or sent anywhere. A DPN is
 * addressed to the director at home, so no external service (AI or
 * otherwise) may see it. Only the fields in DirectorPenaltyNotice leave this
 * function, and the address is not one of them.
 *
 * Must only be imported from server code — never from a component.
 */

export { PdfTooLongError, PdfUnreadableError }

/** A notice runs to 4 pages; a long period table might add one or two. */
export const MAX_DPN_PAGES = 12

export async function readDirectorPenaltyNotice(bytes: Uint8Array): Promise<DpnParseResult> {
  const { pages } = await readPdfPageCells(bytes, MAX_DPN_PAGES)
  return parseDirectorPenaltyNotice(pages)
}
