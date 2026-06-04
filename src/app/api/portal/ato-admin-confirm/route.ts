import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { requireStaffUser } from '@/lib/auth/staff'

export async function POST(req: NextRequest) {
  try {
    const user = await requireStaffUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { clientId } = await req.json()
    if (!clientId) return NextResponse.json({ error: 'Missing clientId' }, { status: 400 })

    const supabase = getSupabaseServerClient()
    const { error } = await supabase
      .from('clients')
      .update({
        ato_admin_confirmed: true,
        ato_admin_confirmed_at: new Date().toISOString(),
      })
      .eq('id', clientId)

    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[POST /api/portal/ato-admin-confirm]', err)
    return NextResponse.json({ error: 'Failed to confirm' }, { status: 500 })
  }
}
