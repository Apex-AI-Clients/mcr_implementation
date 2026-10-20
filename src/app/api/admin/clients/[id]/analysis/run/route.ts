import { NextRequest, NextResponse, after } from 'next/server'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { requireStaffUser } from '@/lib/auth/staff'
import { scheduleClientAnalysis } from '@/lib/analysis/autoRun'

/**
 * POST — work out whatever is out of date for this client now: the "Run now"
 * on the readiness checklist. The same run an upload starts (autoRun.ts), for
 * files uploaded before runs were automatic. One run per client: when one is
 * already going, it is returned instead.
 */

/** The run works inside after(), on this function's time (800s on Vercel Pro). */
export const maxDuration = 800

interface Params {
  params: Promise<{ id: string }>
}

export async function POST(_req: NextRequest, { params }: Params) {
  try {
    const staff = await requireStaffUser()
    if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id: clientId } = await params
    const supabase = getSupabaseServerClient()
    const { data: client } = await supabase.from('clients').select('id, archived_at').eq('id', clientId).maybeSingle()
    if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 })
    if (client.archived_at) return NextResponse.json({ error: 'This file is archived.' }, { status: 409 })

    const { jobId, started } = await scheduleClientAnalysis(supabase, clientId, (task) => after(task))
    if (!jobId) return NextResponse.json({ error: 'Could not start the run.' }, { status: 500 })
    return NextResponse.json({ jobId, started })
  } catch (err) {
    console.error('[POST analysis/run]', err instanceof Error ? err.message : 'unknown')
    return NextResponse.json({ error: 'Could not start the run.' }, { status: 500 })
  }
}
