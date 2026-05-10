import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServerClient, getSupabaseAuthClient } from '@/lib/supabase/server'

interface Params {
  params: Promise<{ id: string }>
}

async function requireAdmin() {
  const authClient = await getSupabaseAuthClient()
  const {
    data: { user },
    error,
  } = await authClient.auth.getUser()
  if (error) console.error('[requireAdmin] auth error:', error.message)
  if (!user) return null
  if (user.app_metadata?.role === 'client') return null
  return user
}

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const admin = await requireAdmin()
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    const supabase = getSupabaseServerClient()

    const { data: client, error } = await supabase
      .from('clients')
      .select('*')
      .eq('id', id)
      .single()

    if (error || !client) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 })
    }

    const { data: documents } = await supabase
      .from('documents')
      .select('*')
      .eq('client_id', id)
      .order('uploaded_at', { ascending: false })

    return NextResponse.json({ ...client, documents: documents ?? [] })
  } catch (err) {
    console.error('[GET /api/admin/clients/[id]]', err)
    return NextResponse.json({ error: 'Failed to fetch client' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const admin = await requireAdmin()
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    const body = await req.json()
    const supabase = getSupabaseServerClient()

    const { data, error } = await supabase
      .from('clients')
      .update(body)
      .eq('id', id)
      .select()
      .single()

    if (error) throw error
    return NextResponse.json(data)
  } catch (err) {
    console.error('[PATCH /api/admin/clients/[id]]', err)
    return NextResponse.json({ error: 'Failed to update client' }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const admin = await requireAdmin()
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    const supabase = getSupabaseServerClient()

    const { data: client, error: lookupError } = await supabase
      .from('clients')
      .select('id, auth_user_id')
      .eq('id', id)
      .maybeSingle()

    if (lookupError || !client) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 })
    }

    // 1. Remove storage objects. Files live at documents/{client_id}/{uuid}.{ext}.
    const { data: docs } = await supabase
      .from('documents')
      .select('file_path')
      .eq('client_id', id)

    const paths = (docs ?? []).map((d) => d.file_path).filter(Boolean) as string[]
    if (paths.length > 0) {
      const { error: storageError } = await supabase.storage.from('documents').remove(paths)
      if (storageError) {
        // Log but proceed — DB delete should still go through. Storage orphans
        // are recoverable via the bucket; an aborted delete leaves a worse state.
        console.error('[DELETE /api/admin/clients/[id]] storage.remove', storageError)
      }
    }

    // 2. Delete the clients row. FK CASCADE handles documents, accountant_details,
    // company_details, and document_chunks.
    const { error: deleteError } = await supabase.from('clients').delete().eq('id', id)
    if (deleteError) throw deleteError

    // 3. Remove the auth user so the email can be reused. ON DELETE SET NULL on
    // clients.auth_user_id means this can also be done before step 2; doing it
    // last keeps the auth user around if the DB delete fails.
    if (client.auth_user_id) {
      const { error: authError } = await supabase.auth.admin.deleteUser(client.auth_user_id)
      if (authError) {
        console.error('[DELETE /api/admin/clients/[id]] auth.admin.deleteUser', authError)
      }
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    const detail = err instanceof Error ? err.message : JSON.stringify(err)
    console.error('[DELETE /api/admin/clients/[id]]', detail, err)
    return NextResponse.json(
      { error: 'Failed to delete client', detail },
      { status: 500 },
    )
  }
}
