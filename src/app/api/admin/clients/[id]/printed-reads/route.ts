import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { requireStaffUser } from '@/lib/auth/staff'
import { loadPrintedComparison } from '@/lib/printed/store'

/**
 * POST — "Read the PDFs again": every financial statements PDF of the client
 * read as printed (src/lib/printed), on our own server, no model. Each takes
 * well under a second. The page then shows the comparison built from them.
 */

interface Params {
  params: Promise<{ id: string }>
}

export async function POST(_req: NextRequest, { params }: Params) {
  try {
    const staff = await requireStaffUser()
    if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { id: clientId } = await params
    const { comparison } = await loadPrintedComparison(getSupabaseServerClient(), clientId, { force: true })
    return NextResponse.json({ ok: true, documents: comparison.documents.length, failures: comparison.failures.length })
  } catch (err) {
    console.error('[POST printed-reads]', err instanceof Error ? err.message : 'unknown')
    return NextResponse.json({ error: 'Failed to read the PDFs' }, { status: 500 })
  }
}
