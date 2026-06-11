/**
 * POST /api/admin/clients/[id]/financials-comparison
 *
 * Admin-only. Builds the multi-year comparison from already-extracted
 * financial_statements rows, generates an AI narrative summary (best-effort),
 * and upserts the result into financial_comparisons (one row per client_id).
 *
 * The build logic lives in src/lib/financials/comparisonJob.ts and is shared
 * with the background job. This route is the synchronous "rebuild comparison
 * only" path (fast — no extraction). Requires extraction to have already run
 * for at least 2 years; returns 400 otherwise.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServerClient, getSupabaseAuthClient } from '@/lib/supabase/server'
import { buildAndPersistComparison } from '@/lib/financials/comparisonJob'

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

export async function POST(_req: NextRequest, { params }: Params) {
  try {
    const admin = await requireAdmin()
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id: clientId } = await params
    const supabase = getSupabaseServerClient()

    const { data: client } = await supabase
      .from('clients')
      .select('id')
      .eq('id', clientId)
      .maybeSingle()
    if (!client) {
      return NextResponse.json({ error: 'Client not found.' }, { status: 404 })
    }

    const result = await buildAndPersistComparison(clientId, supabase)
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, extractedCount: result.extractedCount },
        { status: result.status },
      )
    }

    return NextResponse.json(result.payload)
  } catch (err) {
    console.error('[POST financials-comparison] unexpected', err)
    return NextResponse.json({ error: 'Failed to compute comparison.' }, { status: 500 })
  }
}
