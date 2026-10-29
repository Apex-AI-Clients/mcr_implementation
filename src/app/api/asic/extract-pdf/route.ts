import { NextRequest, NextResponse } from 'next/server'
import { requireStaffUser } from '@/lib/auth/staff'
import { NO_STORE, readAsicUpload } from '@/lib/asic/readUpload'

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

export async function POST(req: NextRequest) {
  const staff = await requireStaffUser()
  if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Every check and the parse are shared with storing an extract on a client
  // file (src/lib/asic/readUpload.ts). Here the file is dropped afterwards.
  const upload = await readAsicUpload(req, ROUTE)
  if (!upload.ok) return upload.response

  console.info(`[${ROUTE}] outcome=ok pages=${upload.pageCount}`)
  return NextResponse.json({ extract: upload.extract }, { headers: NO_STORE })
}
