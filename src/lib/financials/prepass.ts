import { PDFDocument } from 'pdf-lib'
import { PdfTooLongError, PdfUnreadableError, readPdfPageLines } from '@/lib/pdf/pageLines'
import { classifyFinancialDocument, type PrepassClassification } from './classifyPages'

/**
 * Server-only. The text-layer pre-pass for a financials PDF: what each page
 * is, which pages hold the statements, and what years and entity their
 * headings name — before anything is sent to the model.
 *
 * Runs on our own server with no external call of any kind. Works on signed
 * PDFs that are encrypted with an owner password only (they open without a
 * password; pdf-lib cannot cut pages from them, but pdf.js reads their text).
 *
 * Never throws for a bad document: a PDF that cannot be read, needs a password,
 * or has no text layer comes back as kind 'unknown' with a reason, and the
 * caller falls back to today's whole-document path.
 *
 * Must only be imported from server code — never from a component.
 */

/** A financials bundle is ~25 pages; this only bounds the work one upload can cause. */
export const MAX_FINANCIALS_PAGES = 200

export type PrepassFailure = 'unreadable' | 'password_protected' | 'too_long' | 'no_text_layer'

export interface FinancialsPrepass {
  classification: PrepassClassification
  encrypted: boolean
  pageCount: number
  /** Why the pre-pass found nothing usable; null when it read the document. */
  failure: PrepassFailure | null
}

const EMPTY: PrepassClassification = {
  kind: 'unknown',
  hasTextLayer: false,
  pages: [],
  statementPages: { income_statement: [], balance_sheet: [] },
  periods: [],
  headingYears: [],
  currentPeriodYear: null,
  comparativeYears: [],
  entity: null,
}

/** Encrypted at all (owner password included). pdf-lib only reads the trailer here. */
export async function isEncryptedPdf(bytes: Uint8Array): Promise<boolean> {
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })
    return doc.isEncrypted
  } catch {
    return false
  }
}

export async function runFinancialsPrepass(bytes: Uint8Array): Promise<FinancialsPrepass> {
  const encrypted = await isEncryptedPdf(bytes)

  let pages: string[][]
  let pageCount: number
  try {
    ;({ pages, pageCount } = await readPdfPageLines(bytes, MAX_FINANCIALS_PAGES))
  } catch (err) {
    const failure: PrepassFailure =
      err instanceof PdfTooLongError
        ? 'too_long'
        : err instanceof PdfUnreadableError && err.passwordProtected
          ? 'password_protected'
          : 'unreadable'
    return {
      classification: EMPTY,
      encrypted,
      pageCount: err instanceof PdfTooLongError ? err.pageCount : 0,
      failure,
    }
  }

  const classification = classifyFinancialDocument(pages)
  return {
    classification,
    encrypted,
    pageCount,
    failure: classification.hasTextLayer ? null : 'no_text_layer',
  }
}
