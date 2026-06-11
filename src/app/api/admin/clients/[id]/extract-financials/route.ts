/**
 * POST /api/admin/clients/[id]/extract-financials
 *
 * Admin-only. Runs the OpenRouter + Gemini PDF extractor over uploaded
 * historical/current financials documents and persists the canonical line-item
 * data into financial_statements.
 *
 * The orchestration lives in src/lib/financials/comparisonJob.ts so the
 * background comparison job and this synchronous route share one implementation.
 * This route is retained for direct/manual extraction; the UI now drives the
 * full flow through the background job (/financials-comparison/start).
 *
 * Body (optional): { documentIds?: string[] } — restricts the batch.
 * Returns: { extracted, skipped, errors: [{ documentId, filename, error }] }
 */
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServerClient, getSupabaseAuthClient } from '@/lib/supabase/server'
import { extractAllFinancials } from '@/lib/financials/comparisonJob'

// Needs headroom for several sequential PDF extractions. Requires Fluid Compute
// to reach the full 300s on Vercel (Hobby caps at 60s without it).
export const maxDuration = 300

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

    let body: { documentIds?: string[] } = {}
    try {
      body = (await req.json()) as { documentIds?: string[] }
    } catch {
      // optional body
    }

    const supabase = getSupabaseServerClient()
    const { data: client } = await supabase
      .from('clients')
      .select('id')
      .eq('id', clientId)
      .maybeSingle()
    if (!client) {
      return NextResponse.json({ error: 'Client not found.' }, { status: 404 })
    }

    const result = await extractAllFinancials(clientId, supabase, {
      documentIds: body.documentIds,
    })
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to extract financials.'
    // "No financials documents found" is the only expected user-facing throw.
    const status = message.includes('No financials documents') ? 404 : 500
    console.error('[extract-financials] error', err)
    return NextResponse.json({ error: message }, { status })
  }
}
