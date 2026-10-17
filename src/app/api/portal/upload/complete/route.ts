import { NextRequest, NextResponse, after } from 'next/server'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { requireStaffUser } from '@/lib/auth/staff'
import { getStoredObjectInfo, removeFromStorage } from '@/lib/storage/upload'
import { checkUploadRequest } from '@/lib/storage/rules'
import { recomputeClientStatus } from '@/lib/clients/status'
import { DPN_CATEGORY, clearNoneIssued, readAndStoreNotice } from '@/lib/dpn/store'
import { categoryTriggersAnalysis, scheduleClientAnalysis } from '@/lib/analysis/autoRun'

/**
 * The automatic run started below works inside after(), which shares this
 * function's time: up to 800s on Vercel Pro with Fluid Compute, as the
 * comparison start route.
 */
export const maxDuration = 800

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

    // A director penalty notice is read straight away: in memory, no AI, about
    // a second. "None issued" can no longer be true, so that tick is cleared.
    // Neither can fail the upload: the file is stored, and an unread notice
    // can be read again from the client page.
    if (docCategory === DPN_CATEGORY) {
      try {
        await clearNoneIssued(supabase, clientId)
        await readAndStoreNotice(supabase, document)
      } catch (err) {
        console.error('[POST /api/portal/upload/complete] DPN read failed', {
          documentId: document.id,
          error: err instanceof Error ? err.name : 'unknown',
        })
      }
    }

    // Work out whatever this file changes, in the background: the lodgement
    // figures, the statement extraction and comparison. One run per client.
    if (categoryTriggersAnalysis(String(docCategory))) {
      try {
        await scheduleClientAnalysis(supabase, clientId, (task) => after(task))
      } catch (err) {
        console.error('[POST /api/portal/upload/complete] scheduling the analysis failed', err instanceof Error ? err.name : 'unknown')
      }
    }

    return NextResponse.json({ documentId: document.id }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/portal/upload/complete]', err)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}
