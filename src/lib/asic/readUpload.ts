import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { extractPdfLines, PdfTooLongError, PdfUnreadableError } from './extractText'
import { parseAsicExtract } from './parse'
import { ASIC_PDF_FIELD, ASIC_PDF_MAX_BYTES, ASIC_PDF_MIME, UPLOAD_MESSAGES, hasPdfMagic } from './upload'
import type { AsicExtract } from './types'

/**
 * An uploaded ASIC extract PDF, checked and parsed: the one path both
 * POST /api/asic/extract-pdf (parse only) and POST /api/admin/clients/[id]/asic-extract
 * (parse and keep on the client file) take, so they refuse the same files the
 * same way.
 *
 * Nothing about the file's contents is logged — not its text, not a name, not
 * an ACN, not its filename. The log line is the outcome and the page count.
 */

/** Room for the multipart envelope around a file that is itself within the limit. */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024

// The answer can carry dates of birth: nothing between here and the browser keeps it.
export const NO_STORE = { 'Cache-Control': 'no-store' }

/**
 * Which page each part of the extract is printed on, so a value taken from it
 * can open the PDF at that page. Page numbers only: nothing the page says.
 */
export interface AsicSectionPages {
  /** Organisation Details: name, ACN, ABN, registration date. */
  organisation: number | null
  /** Address Details: registered office, principal place of business. */
  addresses: number | null
  /** Officeholders: directors, dates of birth, appointment dates. */
  directors: number | null
}

const firstPage = (pages: string[][], re: RegExp): number | null => {
  const i = pages.findIndex((lines) => lines.some((line) => re.test(line.trim())))
  return i < 0 ? null : i + 1
}

export function sectionPages(pages: string[][]): AsicSectionPages {
  return {
    organisation: firstPage(pages, /^(Current )?Organisation Details\b/i),
    addresses: firstPage(pages, /^Address Details\b/i),
    directors: firstPage(pages, /^Officeholders\b|^Appointment date:/i),
  }
}

export type AsicUpload =
  | { ok: true; bytes: Uint8Array; pageCount: number; extract: AsicExtract; pages: AsicSectionPages }
  | { ok: false; response: NextResponse }

export async function readAsicUpload(req: NextRequest, route: string): Promise<AsicUpload> {
  const refuse = (status: number, error: string, reason: string, pages?: number): AsicUpload => {
    console.info(`[${route}] outcome=${reason}${pages === undefined ? '' : ` pages=${pages}`}`)
    return { ok: false, response: NextResponse.json({ error, reason }, { status, headers: NO_STORE }) }
  }

  // Before the body is read at all, when the client says how big it is.
  const declared = Number(req.headers.get('content-length') ?? 0)
  if (declared > ASIC_PDF_MAX_BYTES + MULTIPART_OVERHEAD_BYTES) {
    return refuse(413, UPLOAD_MESSAGES.tooLarge, 'too_large')
  }

  let file: FormDataEntryValue | null
  try {
    file = (await req.formData()).get(ASIC_PDF_FIELD)
  } catch {
    return refuse(400, UPLOAD_MESSAGES.missing, 'not_form_data')
  }
  if (!file || typeof file === 'string') return refuse(400, UPLOAD_MESSAGES.missing, 'no_file')

  if (file.size === 0) return refuse(400, UPLOAD_MESSAGES.empty, 'empty')
  if (file.size > ASIC_PDF_MAX_BYTES) return refuse(413, UPLOAD_MESSAGES.tooLarge, 'too_large')

  // Both checks, not either: the declared type is whatever the browser says,
  // and the magic bytes alone would accept a PDF sent as something else.
  if (file.type !== ASIC_PDF_MIME) return refuse(415, UPLOAD_MESSAGES.notPdf, 'not_pdf_type')
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (!hasPdfMagic(bytes)) return refuse(415, UPLOAD_MESSAGES.notPdf, 'not_pdf_bytes')

  let pageCount: number
  let lines: string[]
  let pages: string[][]
  try {
    ;({ pageCount, lines, pages } = await extractPdfLines(bytes))
  } catch (err) {
    if (err instanceof PdfTooLongError) {
      return refuse(422, UPLOAD_MESSAGES.tooManyPages, 'too_many_pages', err.pageCount)
    }
    if (err instanceof PdfUnreadableError) {
      return refuse(422, UPLOAD_MESSAGES.unreadable, 'unreadable')
    }
    const kind = err instanceof Error ? err.name : 'unknown'
    console.error(`[${route}] outcome=failed error=${kind}`)
    return {
      ok: false,
      response: NextResponse.json({ error: UPLOAD_MESSAGES.failed, reason: 'failed' }, { status: 500, headers: NO_STORE }),
    }
  }

  const result = parseAsicExtract(lines)
  if (!result.ok) return refuse(422, result.message, result.reason, pageCount)
  return { ok: true, bytes, pageCount, extract: result.extract, pages: sectionPages(pages) }
}
