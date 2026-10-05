import { PDFDocument } from 'pdf-lib'
import type { PrepassClassification } from './classifyPages'
import type { StatementHalfKey } from './types'

/**
 * Which pages of a financials PDF go to the model.
 *
 *   statement_pages          Unencrypted, statements found: send only those
 *                            pages. A tax return or notes page cannot be read
 *                            because it is not in the file.
 *   named_pages_whole_file   Encrypted, statements found: pdf-lib cannot cut
 *                            pages from an encrypted PDF (the copy comes out
 *                            blank), so the whole file goes, and the prompt
 *                            names the statement pages as the only ones to read.
 *   first_pages_fallback     Unencrypted, nothing found, long file: today's
 *                            first-8-pages trim.
 *   whole_file               Anything else: the file as it is.
 */

export const FALLBACK_MAX_PAGES = 8

export type PageSelectionMode =
  | 'statement_pages'
  | 'named_pages_whole_file'
  | 'first_pages_fallback'
  | 'whole_file'

export interface PageSelection {
  mode: PageSelectionMode
  /** 1-based pages of the original file that are sent, in order. */
  sentPages: number[]
  /** Statement pages in the ORIGINAL file's numbering (empty when none were found). */
  statementPages: Record<StatementHalfKey, number[]>
}

export function selectPages(input: {
  encrypted: boolean
  pageCount: number
  classification: Pick<PrepassClassification, 'statementPages'>
}): PageSelection {
  const { encrypted, pageCount, classification } = input
  const statementPages = classification.statementPages
  const union = [...new Set([...statementPages.income_statement, ...statementPages.balance_sheet])]
    .filter((p) => p >= 1 && p <= pageCount)
    .sort((a, b) => a - b)
  const all = Array.from({ length: pageCount }, (_, i) => i + 1)

  if (union.length > 0) {
    return encrypted
      ? { mode: 'named_pages_whole_file', sentPages: all, statementPages }
      : { mode: 'statement_pages', sentPages: union, statementPages }
  }
  if (!encrypted && pageCount > FALLBACK_MAX_PAGES) {
    return { mode: 'first_pages_fallback', sentPages: all.slice(0, FALLBACK_MAX_PAGES), statementPages }
  }
  return { mode: 'whole_file', sentPages: all, statementPages }
}

/**
 * The bytes to send for a selection. Only the two trimming modes build a new
 * file; the others return the original untouched.
 */
export async function bytesForSelection(bytes: Uint8Array, selection: PageSelection): Promise<Uint8Array> {
  if (selection.mode !== 'statement_pages' && selection.mode !== 'first_pages_fallback') return bytes
  const source = await PDFDocument.load(bytes)
  if (selection.sentPages.length === source.getPageCount()) return bytes
  const out = await PDFDocument.create()
  const copied = await out.copyPages(
    source,
    selection.sentPages.map((p) => p - 1),
  )
  for (const page of copied) out.addPage(page)
  return out.save()
}
