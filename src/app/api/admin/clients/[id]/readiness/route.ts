import { NextResponse } from 'next/server'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { requireStaffUser } from '@/lib/auth/staff'
import { loadReadiness } from '@/lib/sbr/loadReadiness'

/**
 * GET — the readiness checklist as it is now.
 *
 * The client page renders the checklist once; this is how it stays true
 * afterwards: followed while something is processing, and re-read whenever the
 * page is shown again (the back button restores the page as it was rendered,
 * which may be minutes old). Read only: unlike the page, it never starts a run.
 */

interface Params {
  params: Promise<{ id: string }>
}

export async function GET(_req: Request, { params }: Params) {
  try {
    const staff = await requireStaffUser()
    if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id: clientId } = await params
    const readiness = await loadReadiness(getSupabaseServerClient(), clientId)
    return NextResponse.json(readiness, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    console.error('[GET readiness]', err instanceof Error ? err.message : 'unknown')
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 })
  }
}
