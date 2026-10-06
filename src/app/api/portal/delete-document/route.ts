import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { requireStaffUser } from '@/lib/auth/staff'
import { recomputeClientStatus } from '@/lib/clients/status'

export async function POST(req: NextRequest) {
  const user = await requireStaffUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { documentId, clientId } = await req.json()
  if (!documentId || !clientId) {
    return NextResponse.json({ error: 'Missing documentId or clientId' }, { status: 400 })
  }

  const supabase = getSupabaseServerClient()

  // Verify the document belongs to the supplied client.
  const { data: doc } = await supabase
    .from('documents')
    .select('id, file_path, client_id')
    .eq('id', documentId)
    .eq('client_id', clientId)
    .single()

  if (!doc) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 })
  }

  if (doc.file_path) {
    await supabase.storage.from('documents').remove([doc.file_path])
  }

  const { error } = await supabase
    .from('documents')
    .delete()
    .eq('id', documentId)
    .eq('client_id', clientId)

  if (error) {
    console.error('[POST /api/portal/delete-document]', error)
    return NextResponse.json({ error: 'Failed to delete document' }, { status: 500 })
  }

  // A required category may now be empty.
  await recomputeClientStatus(supabase, clientId)

  return NextResponse.json({ success: true })
}
