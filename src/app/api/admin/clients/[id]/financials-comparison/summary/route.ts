import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { requireStaffUser } from '@/lib/auth/staff'
import { ensureComparisonSummary } from '@/lib/financials/comparisonSummary'

/**
 * POST — the AI summary of the client's stored comparison, written now if it
 * has none. Called when staff open the comparison page after an automatic
 * run, which stores the figures only.
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
      return NextResponse.json({ aiSummary: outcome.text, aiSummaryGeneratedAt: outcome.generatedAt })
    case 'none':
      return NextResponse.json({ error: 'No up-to-date comparison to summarise.' }, { status: 404 })
    case 'failed':
      return NextResponse.json({ error: 'The summary could not be written. Try again.' }, { status: 502 })
  }
}
