import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { isTokenExpired } from '@/lib/tokens'

export async function POST(req: NextRequest) {
  try {
    const token = req.headers.get('x-client-token')
    if (!token) {
      return NextResponse.json({ error: 'Missing client token' }, { status: 401 })
    }

    const supabase = await getSupabaseServerClient()

    const { data: client } = await supabase
      .from('clients')
      .select('id, link_expires_at')
      .eq('magic_link_token', token)
      .single()

    if (!client) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
    }

    if (isTokenExpired(client.link_expires_at)) {
      return NextResponse.json({ error: 'Token expired' }, { status: 410 })
    }

    const { error } = await supabase
      .from('clients')
      .update({
        ato_admin_confirmed: true,
        ato_admin_confirmed_at: new Date().toISOString(),
      })
      .eq('id', client.id)

    if (error) throw error

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[POST /api/portal/ato-admin-confirm]', err)
    return NextResponse.json({ error: 'Failed to confirm' }, { status: 500 })
  }
}
