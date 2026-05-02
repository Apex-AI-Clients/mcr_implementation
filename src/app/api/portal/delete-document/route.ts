import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { getPortalClient } from '@/lib/auth/portal'

export async function POST(req: NextRequest) {
  const ctx = await getPortalClient()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { documentId } = await req.json()
  if (!documentId) {
    return NextResponse.json({ error: 'Missing documentId' }, { status: 400 })
  }

  const supabase = getSupabaseServerClient()

  // Verify document belongs to this client
  const { data: doc } = await supabase
    .from('documents')
    .select('id, file_path, client_id')
    .eq('id', documentId)
    .eq('client_id', ctx.clientId)
    .single()

  if (!doc) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 })
  }

  // Delete from storage
  if (doc.file_path) {
    await supabase.storage.from('documents').remove([doc.file_path])
  }

  // Delete from database
  const { error } = await supabase
    .from('documents')
    .delete()
    .eq('id', documentId)
    .eq('client_id', ctx.clientId)

  if (error) {
    console.error('[POST /api/portal/delete-document]', error)
    return NextResponse.json({ error: 'Failed to delete document' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
