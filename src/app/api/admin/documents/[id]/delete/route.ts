import { NextRequest, NextResponse, after } from 'next/server'
import { categoryTriggersAnalysis, scheduleClientAnalysis } from '@/lib/analysis/autoRun'
import { getSupabaseServerClient, getSupabaseAuthClient } from '@/lib/supabase/server'
import { recomputeClientStatus } from '@/lib/clients/status'

/** The analysis started after a delete runs inside after(), on this function's time. */
export const maxDuration = 800

async function requireStaff() {
  const authClient = await getSupabaseAuthClient()
  const {
    data: { user },
    error,
  } = await authClient.auth.getUser()
  if (error) console.error('[requireStaff] auth error:', error.message)
  return user ?? null
}

interface Props {
  params: Promise<{ id: string }>
}

export async function POST(_req: NextRequest, { params }: Props) {
  const staff = await requireStaff()
  if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: documentId } = await params
  const supabase = getSupabaseServerClient()

  const { data: doc } = await supabase
    .from('documents')
    .select('id, file_path, client_id, doc_category')
    .eq('id', documentId)
    .single()

  if (!doc) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 })
  }

  if (doc.file_path) {
    const { error: storageError } = await supabase.storage.from('documents').remove([doc.file_path])
    if (storageError) {
      console.error('[admin/documents/delete] storage error:', storageError)
    }
  }

  const { error: dbError } = await supabase.from('documents').delete().eq('id', documentId)
  if (dbError) {
    console.error('[admin/documents/delete] db error:', dbError)
    return NextResponse.json({ error: 'Failed to delete document' }, { status: 500 })
  }

  // A required category may now be empty.
  await recomputeClientStatus(supabase, doc.client_id)

  // What the file fed (a comparison, the lodgement figures) is worked out
  // again without it, in the background.
  if (categoryTriggersAnalysis(doc.doc_category)) {
    try {
      await scheduleClientAnalysis(supabase, doc.client_id, (task) => after(task))
    } catch (err) {
      console.error('[delete] scheduling the analysis failed', err instanceof Error ? err.name : 'unknown')
    }
  }

  return NextResponse.json({ success: true })
}
