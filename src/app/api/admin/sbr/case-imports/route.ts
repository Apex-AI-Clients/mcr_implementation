import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireStaffUser, staffAuthorName } from '@/lib/auth/staff'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { UploadError } from '@/lib/sbr/import/parseUpload'
import { UnknownCorrectionError, buildApplyPayload } from '@/lib/sbr/import/payload'
import { previewUpload } from '@/lib/sbr/import/preview'
import { TICKED_FIELD, readUpload } from '@/lib/sbr/import/readUpload'
import {
  StoreRefusedError,
  applyImport,
  listImports,
  loadExistingCases,
} from '@/lib/sbr/import/store'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * /api/admin/sbr/case-imports — staff only.
 *
 * GET   the upload history, newest first.
 * POST  "Confirm import": the same file again, plus the corrections staff
 *       ticked (form field `corrections`, a JSON array of their keys).
 *
 * Confirm never trusts figures from the browser. It reads and checks the file
 * again here, against the cases stored now, and saves the new cases plus the
 * ticked corrections (and the details added) in one transaction
 * (sbr_apply_case_import, migration 0028). If the stored cases changed since
 * the preview, so that a tick no longer matches or a correction's starting
 * point moved, nothing is saved and the answer is 409: upload again.
 *
 * A file that would change nothing is not recorded: the answer says so and
 * there is no history row (and so nothing marks predictions as stale).
 *
 * As with the preview, nothing about the file's contents or name is logged.
 */

const ROUTE = '/api/admin/sbr/case-imports'
const NO_STORE = { 'Cache-Control': 'no-store, private' }

const CHANGED =
  'The stored cases changed since this file was checked. Upload it again to see the current comparison.'

const TickedSchema = z.array(z.string().min(1).max(500)).max(5000)

export async function GET() {
  const staff = await requireStaffUser()
  if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const imports = await listImports(getSupabaseServerClient())
    return NextResponse.json({ imports }, { headers: NO_STORE })
  } catch (err) {
    console.error(`[GET ${ROUTE}] outcome=failed error=${err instanceof Error ? err.name : 'unknown'}`)
    return NextResponse.json({ error: 'Failed to load the upload history.' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const staff = await requireStaffUser()
  if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const upload = await readUpload(req)
  if (!upload.ok) {
    return NextResponse.json({ error: upload.error }, { status: upload.status, headers: NO_STORE })
  }

  let ticked: string[]
  try {
    ticked = TickedSchema.parse(JSON.parse(String(upload.form.get(TICKED_FIELD) ?? '[]')))
  } catch {
    return NextResponse.json({ error: 'Invalid corrections list.' }, { status: 400, headers: NO_STORE })
  }

  try {
    const supabase = getSupabaseServerClient()
    const preview = previewUpload(upload.bytes, upload.fileName, await loadExistingCases(supabase))
    const payload = buildApplyPayload(preview, new Set(ticked), {
      uploadedBy: staffAuthorName(staff),
      uploadedByUserId: staff.id,
      fileName: upload.fileName,
    })
    const { counts } = payload.p_import

    if (payload.p_new_cases.length === 0 && payload.p_corrections.length === 0) {
      console.info(`[POST ${ROUTE}] outcome=nothing_to_save counts=${JSON.stringify(counts)}`)
      return NextResponse.json({ importId: null, counts }, { headers: NO_STORE })
    }

    const importId = await applyImport(supabase, payload)
    console.info(`[POST ${ROUTE}] outcome=saved counts=${JSON.stringify(counts)}`)
    return NextResponse.json({ importId, counts }, { status: 201, headers: NO_STORE })
  } catch (err) {
    if (err instanceof UploadError) {
      return NextResponse.json({ error: err.message }, { status: 422, headers: NO_STORE })
    }
    if (err instanceof UnknownCorrectionError || (err instanceof StoreRefusedError && err.refusal === 'changed')) {
      console.info(`[POST ${ROUTE}] outcome=changed_since_preview`)
      return NextResponse.json({ error: CHANGED }, { status: 409, headers: NO_STORE })
    }
    console.error(`[POST ${ROUTE}] outcome=failed error=${err instanceof Error ? err.name : 'unknown'}`)
    return NextResponse.json(
      { error: 'The import could not be saved. Nothing was changed.' },
      { status: 500, headers: NO_STORE },
    )
  }
}
