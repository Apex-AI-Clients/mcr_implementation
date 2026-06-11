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
 * compute time. With Fluid Compute the budget is up to 300s (Hobby) / 800s
 * (Pro, configurable). Raise maxDuration once on Pro if jobs approach the cap.
 */
import { NextRequest, NextResponse } from 'next/server'
import { after } from 'next/server'
import { getSupabaseServerClient, getSupabaseAuthClient } from '@/lib/supabase/server'
import { runComparisonJob } from '@/lib/financials/comparisonJob'

export const maxDuration = 300

// An 'active' job older than this is assumed dead (e.g. the function instance
// was recycled mid-run) and will not block a fresh start.
const STALE_JOB_MS = 15 * 60 * 1000

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
    // exists for this client, return it instead of starting another. A job that
    // hasn't updated within STALE_JOB_MS is treated as dead and superseded.
    const { data: active } = await supabase
      .from('financial_comparison_jobs')
      .select('id, updated_at')
      .eq('client_id', clientId)
      .in('status', ['pending', 'processing'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (active) {
      const fresh = Date.now() - new Date(active.updated_at).getTime() < STALE_JOB_MS
      if (fresh) {
        return NextResponse.json({ jobId: active.id, reused: true })
      }
      await supabase
        .from('financial_comparison_jobs')
        .update({
          status: 'failed',
          error: 'Superseded by a new run (previous job went stale).',
          updated_at: new Date().toISOString(),
          finished_at: new Date().toISOString(),
        })
        .eq('id', active.id)
    }

    const { data: job, error: insertError } = await supabase
      .from('financial_comparison_jobs')
      .insert({ client_id: clientId, status: 'pending', mode })
      .select('id')
      .single()

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
