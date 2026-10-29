import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { requireStaffUser, staffAuthorName } from '@/lib/auth/staff'

/**
 * POST /api/admin/cvl/convert — "Convert to CVL" on an SBR client page.
 *
 * Moves the file to the CVL workspace and opens its case in one transaction
 * (cvl_convert_client, migration 0039). The SBR record is kept read-only in
 * the SBR Archive under "Moved to CVL"; documents, details and analyses stay
 * on the client, so the CVL page has them straight away. Nothing is deleted.
 *
 * A lead is converted to CVL through POST /api/admin/clients (workflow 'cvl').
 */

const Body = z.object({ clientId: z.string().uuid() })

export async function POST(req: NextRequest) {
  try {
    const staff = await requireStaffUser()
    if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const parsed = Body.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: 'A client id is required.' }, { status: 400 })

    const supabase = getSupabaseServerClient()
    const { data: caseId, error } = await supabase.rpc('cvl_convert_client', {
      p_client_id: parsed.data.clientId,
      p_by: staffAuthorName(staff),
    })
    if (error) {
      if (error.code === 'P0002') return NextResponse.json({ error: 'Client not found' }, { status: 404 })
      if (error.code === '55000') {
        return NextResponse.json(
          { error: 'Only a client on the SBR client list can be converted to CVL.' },
          { status: 409 },
        )
      }
      throw error
    }

    return NextResponse.json({ ok: true, caseId, href: `/cvl/${parsed.data.clientId}` }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/admin/cvl/convert]', err instanceof Error ? err.message : JSON.stringify(err))
    return NextResponse.json({ error: 'Failed to convert to CVL' }, { status: 500 })
  }
}
