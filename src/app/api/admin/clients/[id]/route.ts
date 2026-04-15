import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServerClient, getSupabaseAuthClient } from '@/lib/supabase/server'

interface Params {
  params: Promise<{ id: string }>
}

async function requireAdmin() {
  const authClient = await getSupabaseAuthClient()
  const { data: { user }, error } = await authClient.auth.getUser()
  if (error) console.error('[requireAdmin] auth error:', error.message)
  if (!user) return null
  return user
}

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    await requireAdmin()
    const { id } = await params
    const supabase = await getSupabaseServerClient()

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

    const { data: followUps } = await supabase
      .from('follow_ups')
      .select('*')
      .eq('client_id', id)
      .order('sent_at', { ascending: false })

    return NextResponse.json({ ...client, documents: documents ?? [], followUps: followUps ?? [] })
  } catch (err) {
    console.error('[GET /api/admin/clients/[id]]', err)
    return NextResponse.json({ error: 'Failed to fetch client' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    await requireAdmin()
    const { id } = await params
    const body = await req.json()
    const supabase = await getSupabaseServerClient()

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
