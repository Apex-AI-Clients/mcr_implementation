import { NextRequest, NextResponse } from 'next/server'
import { requireStaffUser } from '@/lib/auth/staff'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { UploadError } from '@/lib/sbr/import/parseUpload'
import { previewUpload } from '@/lib/sbr/import/preview'
import { readUpload } from '@/lib/sbr/import/readUpload'
import { loadExistingCases } from '@/lib/sbr/import/store'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * POST /api/admin/sbr/case-imports/preview — staff only.
 *
 * Checks an uploaded CSV / Excel file of historical SBR cases against the
 * stored ones and answers what an import would do: new, corrections, already
 * have, details added, rejected (with reasons). Saves nothing; the file is
 * read in memory and dropped. It is never sent to an AI or any other service.
 *
 * The file holds real client names and figures, so nothing about its contents
 * is logged, not even its name: the log line is the outcome and the counts.
 */

const ROUTE = 'POST /api/admin/sbr/case-imports/preview'
const NO_STORE = { 'Cache-Control': 'no-store, private' }

export async function POST(req: NextRequest) {
  const staff = await requireStaffUser()
  if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const upload = await readUpload(req)
  if (!upload.ok) {
    return NextResponse.json({ error: upload.error }, { status: upload.status, headers: NO_STORE })
  }

  try {
    const supabase = getSupabaseServerClient()
    const existing = await loadExistingCases(supabase)
    const preview = previewUpload(upload.bytes, upload.fileName, existing)
    console.info(`[${ROUTE}] outcome=ok counts=${JSON.stringify(preview.counts)}`)
    return NextResponse.json({ fileName: upload.fileName, preview }, { headers: NO_STORE })
  } catch (err) {
    if (err instanceof UploadError) {
      console.info(`[${ROUTE}] outcome=unreadable`)
      return NextResponse.json({ error: err.message }, { status: 422, headers: NO_STORE })
    }
    console.error(`[${ROUTE}] outcome=failed error=${err instanceof Error ? err.name : 'unknown'}`)
    return NextResponse.json(
      { error: 'The file could not be checked. Try again.' },
      { status: 500, headers: NO_STORE },
    )
  }
}
