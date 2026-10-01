import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { requireStaffUser } from '@/lib/auth/staff'
import { restoreUpdate } from '@/lib/clients/archive'

/**
 * POST /api/admin/clients/[id]/restore — "Make client again" in the Archive.
 *
 * Puts the file back on the client list exactly as it was archived. A file
 * archived because its lead was deleted comes back without a lead: lead
 * deletion is permanent, so there is nothing to link it to.
 */

interface Params {
  params: Promise<{ id: string }>
}

export async function POST(_req: NextRequest, { params }: Params) {
  try {
    const staff = await requireStaffUser()
    if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    const supabase = getSupabaseServerClient()

    const { data: client, error: lookupError } = await supabase
      .from('clients')
      .select('id, archived_at')
      .eq('id', id)
      .maybeSingle()
    if (lookupError) throw lookupError
    if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 })
    if (!client.archived_at) {
      return NextResponse.json({ error: 'This client is not archived.' }, { status: 409 })
    }

    const { error } = await supabase.from('clients').update(restoreUpdate()).eq('id', id)
    if (error) throw error

    return NextResponse.json({ ok: true })
  } catch (err) {
    const detail = err instanceof Error ? err.message : JSON.stringify(err)
    console.error('[POST /api/admin/clients/[id]/restore]', detail)
    return NextResponse.json({ error: 'Failed to restore client' }, { status: 500 })
  }
}
