import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { requireStaffUser, staffAuthorName } from '@/lib/auth/staff'
import { DPN_CATEGORY } from '@/lib/dpn/store'

/**
 * POST — staff ticking (or unticking) "No director penalty notice has been
 * issued". Who and when come from the session.
 *
 * Refused while a notice is on file: the two cannot both be true. Uploading a
 * notice clears the tick on its own (upload/complete).
 */

interface Params {
  params: Promise<{ id: string }>
}

const BodySchema = z.object({ confirmed: z.boolean() })

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const staff = await requireStaffUser()
    if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id: clientId } = await params
    const parsed = BodySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

    const supabase = getSupabaseServerClient()

    if (parsed.data.confirmed) {
      const { count, error: countError } = await supabase
        .from('documents')
        .select('id', { count: 'exact', head: true })
        .eq('client_id', clientId)
        .eq('doc_category', DPN_CATEGORY)
      if (countError) throw countError
      if ((count ?? 0) > 0) {
        return NextResponse.json(
          { error: 'A director penalty notice is on file, so "none issued" cannot be ticked.' },
          { status: 409 },
        )
      }
    }

    const { data, error } = await supabase
      .from('clients')
      .update(
        parsed.data.confirmed
          ? {
              no_dpn_confirmed_at: new Date().toISOString(),
              no_dpn_confirmed_by: staffAuthorName(staff),
              no_dpn_cleared_at: null,
              no_dpn_cleared_note: null,
            }
          : { no_dpn_confirmed_at: null, no_dpn_confirmed_by: null },
      )
      .eq('id', clientId)
      .select('id')
      .maybeSingle()
    if (error) throw error
    if (!data) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[POST director-penalty-notices/none-issued]', err instanceof Error ? err.name : 'unknown')
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 })
  }
}
