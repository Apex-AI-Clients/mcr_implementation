import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServerClient, getSupabaseAuthClient } from '@/lib/supabase/server'
import { sendReuploadEmail } from '@/lib/email/resend'

async function requireAdmin() {
  const authClient = await getSupabaseAuthClient()
  const { data: { user }, error } = await authClient.auth.getUser()
  if (error) console.error('[requireAdmin] auth error:', error.message)
  if (!user) return null
  if (user.app_metadata?.role === 'client') return null
  return user
}

interface Props {
  params: Promise<{ id: string }>
}

export async function POST(req: NextRequest, { params }: Props) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: documentId } = await params
  const { message } = await req.json() as { message?: string }

  const supabase = getSupabaseServerClient()

  // Get document with client info
  const { data: doc } = await supabase
    .from('documents')
    .select('id, file_path, client_id, original_filename, doc_category')
    .eq('id', documentId)
    .single()

  if (!doc) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 })
  }

  const { data: client } = await supabase
    .from('clients')
    .select('name, email')
    .eq('id', doc.client_id)
    .single()

  // Delete from storage
  if (doc.file_path) {
    const { error: storageError } = await supabase.storage.from('documents').remove([doc.file_path])
    if (storageError) {
      console.error('[admin/documents/delete] storage error:', storageError)
    }
  }

  // Delete from database
  const { error: dbError } = await supabase
    .from('documents')
    .delete()
    .eq('id', documentId)

  if (dbError) {
    console.error('[admin/documents/delete] db error:', dbError)
    return NextResponse.json({ error: 'Failed to delete document' }, { status: 500 })
  }

  // Send reupload notification if message provided and client exists
  if (message?.trim() && client) {
    try {
      await sendReuploadEmail({
        to: client.email,
        clientName: client.name,
        reason: message.trim(),
        documentName: doc.original_filename,
      })
    } catch (emailErr) {
      console.error('[admin/documents/delete] email failed:', emailErr)
      return NextResponse.json(
        { success: true, warning: 'Document deleted but notification email failed to send' },
      )
    }
  }

  return NextResponse.json({ success: true })
}
