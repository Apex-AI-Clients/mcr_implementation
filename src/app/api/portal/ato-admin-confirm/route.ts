import { NextResponse } from 'next/server'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { getPortalClient } from '@/lib/auth/portal'

export async function POST() {
  try {
    const ctx = await getPortalClient()
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const supabase = getSupabaseServerClient()
    const { error } = await supabase
      .from('clients')
      .update({
        ato_admin_confirmed: true,
        ato_admin_confirmed_at: new Date().toISOString(),
      })
      .eq('id', ctx.clientId)

    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[POST /api/portal/ato-admin-confirm]', err)
    return NextResponse.json({ error: 'Failed to confirm' }, { status: 500 })
  }
}
