import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { requireStaffUser } from '@/lib/auth/staff'
import { createUploadTarget } from '@/lib/storage/upload'
import { checkUploadRequest } from '@/lib/storage/rules'

/**
 * Step 1 of an upload: check the file's description and sign a one-time
 * Storage upload URL. The browser then sends the bytes straight to Storage
 * (Vercel refuses request bodies over 4.5 MB, so they cannot come through
 * here) and calls /api/portal/upload/complete to record the document.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireStaffUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    const clientId = typeof body?.client_id === 'string' ? body.client_id : null
    const filename = typeof body?.filename === 'string' ? body.filename : null

    if (!clientId) {
      return NextResponse.json({ error: 'Missing clientId' }, { status: 400 })
    }
    if (!filename) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    const refusal = checkUploadRequest({
      docCategory: body?.doc_category,
      fileType: body?.file_type,
      fileSize: body?.file_size,
    })
    if (refusal) {
      return NextResponse.json({ error: refusal.error }, { status: refusal.status })
    }

    const supabase = getSupabaseServerClient()
    const target = await createUploadTarget(supabase, clientId, filename)

    return NextResponse.json(target, { status: 201 })
  } catch (err) {
    console.error('[POST /api/portal/upload]', err)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}
