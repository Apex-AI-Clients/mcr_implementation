import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { requireStaffUser, staffAuthorName } from '@/lib/auth/staff'
import { archiveUpdate } from '@/lib/clients/archive'
import { loadCaseAccess } from '@/lib/cvl/caseAccess'

/**
 * POST /api/admin/cvl/[caseId]/remove — "Delete" on the CVL list and page.
 *
 * Takes the file off the CVL list (cvl_cases.removed_at, migration 0047).
 * Nothing is deleted: its forms are kept, and moving it to CVL again reopens
 * the case. A file also in SBR stays on the SBR list untouched; a CVL-only
 * file is archived as well, as before, so it shows in the Archive (CVL tab).
 * Removing one already removed changes nothing and still answers 200.
 */

interface Params {
  params: Promise<{ caseId: string }>
}

export async function POST(_req: NextRequest, { params }: Params) {
  try {
    const staff = await requireStaffUser()
    if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { caseId } = await params
    const supabase = getSupabaseServerClient()
    const access = await loadCaseAccess(supabase, caseId)
    if (!access) return NextResponse.json({ error: 'CVL file not found' }, { status: 404 })
    if (!access.open) return NextResponse.json({ ok: true, inSbr: access.inSbr })

    const by = staffAuthorName(staff)
    const { error } = await supabase
      .from('cvl_cases')
      .update({ removed_at: new Date().toISOString(), removed_by: by })
      .eq('id', caseId)
    if (error) throw error

    // A CVL-only file has nowhere else to be: it goes to the Archive.
    if (access.workflow === 'cvl') {
      const { error: archiveError } = await supabase
        .from('clients')
        .update(archiveUpdate('client_deleted', by))
        .eq('id', access.clientId)
        .is('archived_at', null)
      if (archiveError) throw archiveError
    }

    return NextResponse.json({ ok: true, inSbr: access.inSbr })
  } catch (err) {
    console.error('[POST /api/admin/cvl/[caseId]/remove]', err instanceof Error ? err.message : 'unknown')
    return NextResponse.json({ error: 'Failed to delete the CVL file' }, { status: 500 })
  }
}
