import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { requireStaffUser } from '@/lib/auth/staff'
import { restoreUpdate } from '@/lib/clients/archive'
import { loadCaseAccess } from '@/lib/cvl/caseAccess'

/**
 * POST /api/admin/cvl/[caseId]/to-sbr — "Move to SBR" on a CVL file.
 *
 * The mirror of moving an SBR client to CVL (migration 0047): the file goes
 * on the SBR list and stays in CVL. A CVL-only file becomes an SBR client
 * (workflow 'sbr'); an SBR client archived from SBR is made a client again.
 * Answers 409 when it is already in SBR.
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
    if (!access.open) return NextResponse.json({ error: 'This file is not in CVL.' }, { status: 409 })
    if (access.inSbr) return NextResponse.json({ error: 'This client is already in SBR.' }, { status: 409 })

    // Not archived while in CVL, except from SBR: either way it ends up an SBR client on the list.
    const { error } = await supabase
      .from('clients')
      .update({ ...restoreUpdate(), workflow: 'sbr' })
      .eq('id', access.clientId)
    if (error) throw error

    return NextResponse.json({ ok: true, href: `/clients/${access.clientId}` })
  } catch (err) {
    console.error('[POST /api/admin/cvl/[caseId]/to-sbr]', err instanceof Error ? err.message : 'unknown')
    return NextResponse.json({ error: 'Failed to move the client to SBR' }, { status: 500 })
  }
}
