import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServerClient, getSupabaseAuthClient } from '@/lib/supabase/server'
import { getSignedUrl } from '@/lib/storage/upload'

interface Params {
  params: Promise<{ id: string }>
}

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    // Auth check
    const authClient = await getSupabaseAuthClient()
    const {
      data: { user },
    } = await authClient.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    const supabase = await getSupabaseServerClient()

    const { data: doc, error } = await supabase
      .from('documents')
      .select('file_path, original_filename')
      .eq('id', id)
      .single()

    if (error || !doc) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    }

    const signedUrl = await getSignedUrl(supabase, doc.file_path)

    return NextResponse.json({ url: signedUrl, filename: doc.original_filename })
  } catch (err) {
    console.error('[GET /api/admin/documents/[id]/download]', err)
    return NextResponse.json({ error: 'Failed to generate download URL' }, { status: 500 })
  }
}
