import { NextResponse } from 'next/server'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { requireStaffUser } from '@/lib/auth/staff'
import { ensureAtoAccountSummary } from '@/lib/analysis/atoAccount/store'

interface Params {
  params: Promise<{ id: string; analysisId: string }>
}

/**
 * POST — the AI summary of an income tax or super guarantee analysis,
 * generated now if it has none. Called when staff open its page; automatic
 * runs store the figures only.
 */
export async function POST(_req: Request, { params }: Params) {
  const staff = await requireStaffUser()
  if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, analysisId } = await params
  const outcome = await ensureAtoAccountSummary(getSupabaseServerClient(), id, analysisId)
  switch (outcome.kind) {
    case 'generated':
      return NextResponse.json({ aiSummary: outcome.text, aiSummaryGeneratedAt: outcome.generatedAt })
    case 'not_needed':
    case 'locked':
      return NextResponse.json({ aiSummary: null, aiSummaryGeneratedAt: null, locked: outcome.kind === 'locked' })
    case 'none':
      return NextResponse.json({ error: 'No analysis.' }, { status: 404 })
    case 'failed':
      return NextResponse.json({ error: 'The summary could not be written. Try again.' }, { status: 502 })
  }
}
