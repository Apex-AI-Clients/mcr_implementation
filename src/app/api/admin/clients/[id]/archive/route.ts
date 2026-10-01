import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { requireStaffUser, staffAuthorName } from '@/lib/auth/staff'
import { archiveUpdate } from '@/lib/clients/archive'

/**
 * POST /api/admin/clients/[id]/archive — "Archive client" on the client page.
 *
 * Moves the file out of the client list into the Archive. Nothing is deleted:
 * documents, storage files and the company and accountant details stay, so a
 * restore puts everything back. Archiving one that is already archived changes
 * nothing and still answers 200.
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
    if (client.archived_at) return NextResponse.json({ ok: true, archivedAt: client.archived_at })

    const update = archiveUpdate('client_deleted', staffAuthorName(staff))
    const { error } = await supabase.from('clients').update(update).eq('id', id)
    if (error) throw error

    return NextResponse.json({ ok: true, archivedAt: update.archived_at })
  } catch (err) {
    const detail = err instanceof Error ? err.message : JSON.stringify(err)
    console.error('[POST /api/admin/clients/[id]/archive]', detail)
    return NextResponse.json({ error: 'Failed to archive client' }, { status: 500 })
  }
}
