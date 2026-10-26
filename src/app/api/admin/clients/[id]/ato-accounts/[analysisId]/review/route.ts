import { NextResponse } from 'next/server'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { requireStaffUser, staffAuthorName } from '@/lib/auth/staff'

interface Params {
  params: Promise<{ id: string; analysisId: string }>
}

/**
 * POST — staff have reviewed an income tax or super guarantee analysis whose
 * unexplained difference is above $1,000 (atoAccount/engine.ts): its page
 * and exports unlock. Who and when are recorded; a re-analysis keeps them.
 */
export async function POST(_req: Request, { params }: Params) {
  const staff = await requireStaffUser()
  if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id, analysisId } = await params

  const supabase = getSupabaseServerClient()
  const { data, error } = await supabase
    .from('ato_account_analyses')
    .update({ reviewed_by: staffAuthorName(staff), reviewed_at: new Date().toISOString() })
    .eq('id', analysisId)
    .eq('client_id', id)
    .select('id, reviewed_by, reviewed_at')
    .maybeSingle()
  if (error) {
    console.error('[ato-account review] update failed', error.code)
    return NextResponse.json({ error: 'Could not record the review.' }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'Analysis not found.' }, { status: 404 })
  return NextResponse.json({ reviewedBy: data.reviewed_by, reviewedAt: data.reviewed_at })
}
