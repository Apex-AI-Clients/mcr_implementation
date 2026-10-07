import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { requireStaffUser } from '@/lib/auth/staff'
import { getStoredObjectInfo, removeFromStorage } from '@/lib/storage/upload'
import { checkUploadRequest } from '@/lib/storage/rules'
import { recomputeClientStatus } from '@/lib/clients/status'

/**
 * Step 2 of an upload: the browser has put the file in Storage at the path
 * /api/portal/upload signed. Re-check what actually landed there — the size
 * and type the browser declared are not trusted — and record the document.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireStaffUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    const clientId = typeof body?.client_id === 'string' ? body.client_id : null
    const filePath = typeof body?.path === 'string' ? body.path : null
    const filename = typeof body?.filename === 'string' ? body.filename : null
    const docCategory = body?.doc_category

    if (!clientId) {
      return NextResponse.json({ error: 'Missing clientId' }, { status: 400 })
    }
    // Only a path inside this client's folder, as the signing route makes them.
    if (!filePath || !filename || !filePath.startsWith(`${clientId}/`) || filePath.includes('..')) {
      return NextResponse.json({ error: 'Invalid upload' }, { status: 400 })
    }

    const supabase = getSupabaseServerClient()
    const stored = await getStoredObjectInfo(supabase, filePath)
    if (!stored) {
      return NextResponse.json({ error: 'Upload not found. Please try again.' }, { status: 404 })
    }

    const refusal = checkUploadRequest({
      docCategory,
      fileType: stored.contentType,
      fileSize: stored.size,
    })
    if (refusal) {
      await removeFromStorage(supabase, filePath)
      return NextResponse.json({ error: refusal.error }, { status: refusal.status })
    }

    const { data: document, error: docError } = await supabase
      .from('documents')
      .insert({
        client_id: clientId,
        file_path: filePath,
        original_filename: filename,
        file_type: stored.contentType,
        file_size_bytes: stored.size,
        doc_category: docCategory as string,
        status: 'ready',
      })
      .select()
      .single()

    if (docError || !document) throw docError

    await recomputeClientStatus(supabase, clientId)

    return NextResponse.json({ documentId: document.id }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/portal/upload/complete]', err)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}
