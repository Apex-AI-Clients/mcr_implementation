/**
 * POST /api/admin/clients/[id]/financials-comparison/start
 *
 * Admin-only. Kicks off the slow (3-5 min) financials comparison as a background
 * job and returns a jobId immediately. The actual work runs in Next.js after(),
 * which keeps executing after the response is flushed — within this function's
 * maxDuration budget. The frontend polls the sibling status route until the job
 * row reaches 'done' or 'failed'.
 *
 * Body (optional): { mode?: 'full' | 'compare' }
 *   - 'full'    (default) — extract all PDFs, then build the comparison.
 *   - 'compare'           — rebuild the comparison from existing statements only.
 *
 * Returns: { jobId, reused } — reused=true when an active job already existed.
 *
 * NOTE: after() shares this function's duration budget; it does NOT grant extra
 * compute time. With Fluid Compute the ceiling is 300s on Hobby and 800s on Pro;
 * we're on Pro, so the budget below is set to the full 800s.
 */
import { NextRequest, NextResponse } from 'next/server'
import { after } from 'next/server'
import { getSupabaseServerClient, getSupabaseAuthClient } from '@/lib/supabase/server'
import { runComparisonJob } from '@/lib/financials/comparisonJob'
import { closeDeadJob, isJobDead } from '@/lib/financials/jobLiveness'

export const maxDuration = 800

interface Params {
  params: Promise<{ id: string }>
}

async function requireAdmin() {
  const authClient = await getSupabaseAuthClient()
  const {
    data: { user },
    error,
  } = await authClient.auth.getUser()
  if (error) console.error('[requireAdmin] auth error:', error.message)
  if (!user) return null
  if (user.app_metadata?.role === 'client') return null
  return user
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const admin = await requireAdmin()
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id: clientId } = await params

    let body: { mode?: 'full' | 'compare' } = {}
    try {
      body = (await req.json()) as { mode?: 'full' | 'compare' }
    } catch {
      // optional body
    }
    const mode: 'full' | 'compare' = body.mode === 'compare' ? 'compare' : 'full'

    const supabase = getSupabaseServerClient()

    const { data: client } = await supabase
      .from('clients')
      .select('id')
      .eq('id', clientId)
      .maybeSingle()
    if (!client) {
      return NextResponse.json({ error: 'Client not found.' }, { status: 404 })
    }

    // Guard against duplicate runs (e.g. double-click). If a live job already
    // exists for this client, return it instead of starting another. A job older
    // than the function's lifetime is dead (see jobLiveness) and is closed.
    const { data: active } = await supabase
      .from('financial_comparison_jobs')
      .select('id, status, created_at')
      .eq('client_id', clientId)
      .in('status', ['pending', 'processing'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (active) {
      if (!isJobDead(active)) return NextResponse.json({ jobId: active.id, reused: true })
      await closeDeadJob(supabase, active.id)
    }

    const { data: job, error: insertError } = await supabase
      .from('financial_comparison_jobs')
      .insert({ client_id: clientId, status: 'pending', mode })
      .select('id')
      .single()

    // Another request started a job between our check and this insert: the
    // database allows one active job per client (migration 0027), so hand
    // back the one that won instead of running the extraction twice.
    if (insertError?.code === '23505') {
      const { data: running } = await supabase
        .from('financial_comparison_jobs')
        .select('id')
        .eq('client_id', clientId)
        .in('status', ['pending', 'processing'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (running) return NextResponse.json({ jobId: running.id, reused: true })
    }

    if (insertError || !job) {
      console.error('[financials-comparison/start] insert failed', insertError)
      return NextResponse.json({ error: 'Failed to create job.' }, { status: 500 })
    }

    // Run the work after the response is sent. Bounded by maxDuration above.
    after(async () => {
      await runComparisonJob({ jobId: job.id, clientId, mode, supabase })
    })

    return NextResponse.json({ jobId: job.id, reused: false })
  } catch (err) {
    console.error('[financials-comparison/start] unexpected', err)
    return NextResponse.json({ error: 'Failed to start comparison.' }, { status: 500 })
  }
}
