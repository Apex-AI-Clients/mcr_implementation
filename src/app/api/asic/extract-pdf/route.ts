import { NextRequest, NextResponse } from 'next/server'
import { requireStaffUser } from '@/lib/auth/staff'
import { extractPdfLines, PdfTooLongError, PdfUnreadableError } from '@/lib/asic/extractText'
import { parseAsicExtract } from '@/lib/asic/parse'
import {
  ASIC_PDF_FIELD,
  ASIC_PDF_MAX_BYTES,
  ASIC_PDF_MIME,
  UPLOAD_MESSAGES,
  hasPdfMagic,
} from '@/lib/asic/upload'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * An uploaded ASIC Current Company Extract PDF -> the fields it can fill.
 *
 * Parse-only. The file is read into memory, turned into text on this server
 * (src/lib/asic/extractText.ts), parsed, and dropped when the request ends. It
 * is never stored, and never sent to an AI model or any other service: an
 * extract carries directors' dates of birth and shareholders' residential
 * addresses.
 *
 * For the same reason nothing about the file's contents is logged — not its
 * text, not a name, not an ACN, not even its filename, which usually names the
 * company. The log line is the outcome and the page count, and that is all.
 * Errors are logged by class name only; a message could quote the document.
 */

const ROUTE = 'POST /api/asic/extract-pdf'

/** Room for the multipart envelope around a file that is itself within the limit. */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024

// The answer can carry dates of birth: nothing between here and the browser keeps it.
const NO_STORE = { 'Cache-Control': 'no-store' }

function refuse(status: number, error: string, reason: string, pages?: number) {
  console.info(`[${ROUTE}] outcome=${reason}${pages === undefined ? '' : ` pages=${pages}`}`)
  return NextResponse.json({ error, reason }, { status, headers: NO_STORE })
}

export async function POST(req: NextRequest) {
  const staff = await requireStaffUser()
  if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
  try {
    ;({ pageCount, lines } = await extractPdfLines(bytes))
  } catch (err) {
    if (err instanceof PdfTooLongError) {
      return refuse(422, UPLOAD_MESSAGES.tooManyPages, 'too_many_pages', err.pageCount)
    }
    if (err instanceof PdfUnreadableError) {
      return refuse(422, UPLOAD_MESSAGES.unreadable, 'unreadable')
    }
    const kind = err instanceof Error ? err.name : 'unknown'
    console.error(`[${ROUTE}] outcome=failed error=${kind}`)
    return NextResponse.json(
      { error: UPLOAD_MESSAGES.failed, reason: 'failed' },
      { status: 500, headers: NO_STORE },
    )
  }

  const result = parseAsicExtract(lines)
  if (!result.ok) return refuse(422, result.message, result.reason, pageCount)

  console.info(`[${ROUTE}] outcome=ok pages=${pageCount}`)
  return NextResponse.json({ extract: result.extract }, { headers: NO_STORE })
}
