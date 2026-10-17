import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { requireStaffUser } from '@/lib/auth/staff'
import { ensureLodgementSummary } from '@/lib/analysis/lodgementStore'

/**
 * POST — the AI summary for the client's latest lodgement analysis, generated
 * now if it has none. Called when staff open the lodgement page after an
 * automatic run, which stores the figures only.
 */

interface Params {
  params: Promise<{ id: string }>
}

export async function POST(_req: NextRequest, { params }: Params) {
  const staff = await requireStaffUser()
  if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const outcome = await ensureLodgementSummary(getSupabaseServerClient(), id)
  switch (outcome.kind) {
    case 'generated':
      return NextResponse.json({ aiSummary: outcome.text, aiSummaryGeneratedAt: outcome.generatedAt })
    case 'not_needed':
      return NextResponse.json({ aiSummary: null, aiSummaryGeneratedAt: null })
    case 'none':
      return NextResponse.json({ error: 'No analysis yet.' }, { status: 404 })
    case 'failed':
      return NextResponse.json({ error: 'The summary could not be written. Try again.' }, { status: 502 })
  }
}
