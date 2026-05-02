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

  const { id: clientId } = await params
  const { documentId, reason } = await req.json()

  const supabase = getSupabaseServerClient()

  // Get client info
  const { data: client } = await supabase
    .from('clients')
    .select('name, email')
    .eq('id', clientId)
    .single()

  if (!client) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  }

  // Mark document as needing reupload
  if (documentId) {
    await supabase
      .from('documents')
      .update({ reupload_requested: true, reupload_reason: reason ?? null })
      .eq('id', documentId)
      .eq('client_id', clientId)
  }

  // Send reupload notification email via Resend
  try {
    // Get document name for the email
    let docName = 'a document'
    if (documentId) {
      const { data: doc } = await supabase
        .from('documents')
        .select('original_filename')
        .eq('id', documentId)
        .single()
      if (doc) docName = doc.original_filename
    }

    await sendReuploadEmail({
      to: client.email,
      clientName: client.name,
      reason: reason ?? 'A file needs to be replaced.',
      documentName: docName,
    })
  } catch (emailErr) {
    console.error('[request-reupload] email failed:', emailErr)
    return NextResponse.json(
      { error: 'Reupload flagged but email failed to send' },
      { status: 500 },
    )
  }

  return NextResponse.json({ success: true })
}
