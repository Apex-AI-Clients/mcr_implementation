import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { requireStaffUser } from '@/lib/auth/staff'
import { ensureComparisonSummary } from '@/lib/financials/comparisonSummary'

/**
 * POST — the comparison summary: the stored one while the confirmed figures
 * are unchanged, else written now by Claude from those figures. Says why
 * there is none when it may not be written (AI off, Needs review, fewer than
 * two years, no confirmed key figure).
 */

interface Params {
  params: Promise<{ id: string }>
}

export async function POST(_req: NextRequest, { params }: Params) {
  const staff = await requireStaffUser()
  if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const outcome = await ensureComparisonSummary(getSupabaseServerClient(), id)
  switch (outcome.kind) {
    case 'generated':
      return NextResponse.json({ aiSummary: outcome.text, aiSummaryGeneratedAt: outcome.generatedAt, model: outcome.model })
    case 'blocked':
      return NextResponse.json({ aiSummary: null, blocked: outcome.reason, message: outcome.message })
    case 'failed':
      return NextResponse.json({ error: 'The summary could not be written. Try again.' }, { status: 502 })
  }
}
