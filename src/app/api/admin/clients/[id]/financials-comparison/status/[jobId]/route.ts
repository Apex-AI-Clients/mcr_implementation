/**
 * GET /api/admin/clients/[id]/financials-comparison/status/[jobId]
 *
 * Admin-only. Returns the current state of a background comparison job. The
 * frontend polls this every few seconds until status is 'done' or 'failed'.
 *
 * Returns:
 *   { status, mode, error, result, extractErrors, startedAt, finishedAt, updatedAt }
 *   - result is the ComparisonPayload (only populated when status='done').
 */
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServerClient, getSupabaseAuthClient } from '@/lib/supabase/server'
import type { ComparisonPayload, ExtractError } from '@/lib/financials/comparisonJob'

interface Params {
  params: Promise<{ id: string; jobId: string }>
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

export interface JobStatusResponse {
  status: 'pending' | 'processing' | 'done' | 'failed'
  mode: 'full' | 'compare'
  error: string | null
  result: ComparisonPayload | null
  extractErrors: ExtractError[]
  startedAt: string | null
  finishedAt: string | null
  updatedAt: string
}

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const admin = await requireAdmin()
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id: clientId, jobId } = await params
    const supabase = getSupabaseServerClient()

    const { data: job, error } = await supabase
      .from('financial_comparison_jobs')
      .select('*')
      .eq('id', jobId)
      .eq('client_id', clientId) // scope: a job belongs to one client
      .maybeSingle()

    if (error) {
      console.error('[financials-comparison/status] query failed', error)
      return NextResponse.json({ error: 'Failed to load job.' }, { status: 500 })
    }
    if (!job) {
      return NextResponse.json({ error: 'Job not found.' }, { status: 404 })
    }

    const body: JobStatusResponse = {
      status: job.status as JobStatusResponse['status'],
      mode: job.mode as JobStatusResponse['mode'],
      error: job.error,
      result: (job.result as unknown as ComparisonPayload | null) ?? null,
      extractErrors: (job.extract_errors as unknown as ExtractError[]) ?? [],
      startedAt: job.started_at,
      finishedAt: job.finished_at,
      updatedAt: job.updated_at,
    }

    return NextResponse.json(body)
  } catch (err) {
    console.error('[financials-comparison/status] unexpected', err)
    return NextResponse.json({ error: 'Failed to load job status.' }, { status: 500 })
  }
}
