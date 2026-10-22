import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { requireStaffUser, staffAuthorName } from '@/lib/auth/staff'
import { hardCheckFailures, hardChecksFingerprint } from '@/lib/financials/hardChecks'
import type { FinancialsComparison } from '@/lib/financials/types'

/**
 * POST — staff ticking "I've checked these figures against the source
 * documents" on a comparison with a failed hard check (hardChecks.ts). That
 * unlocks its PDF and CSV.
 *
 * What was checked is worked out here, from the stored comparison as it is
 * now (its fingerprint), never taken from the request. The tick counts only
 * while that comparison and its failures are unchanged.
 */

interface Params {
  params: Promise<{ id: string }>
}

export async function POST(_req: NextRequest, { params }: Params) {
  try {
    const staff = await requireStaffUser()
    if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id: clientId } = await params
    const supabase = getSupabaseServerClient()
    const { data: row, error: readError } = await supabase
      .from('financial_comparisons')
      .select('computed, generated_at')
      .eq('client_id', clientId)
      .maybeSingle()
    if (readError) throw readError

    const comparison = (row?.computed ?? null) as unknown as FinancialsComparison | null
    const fingerprint = hardChecksFingerprint(row?.generated_at ?? null, hardCheckFailures(comparison?.checks))
    if (!fingerprint) {
      return NextResponse.json({ error: 'There is nothing to check here now.' }, { status: 409 })
    }

    const checked = { fingerprint, by: staffAuthorName(staff), at: new Date().toISOString() }
    const { error } = await supabase.from('sbr_readiness_reviews').upsert(
      {
        client_id: clientId,
        item: 'financials',
        fingerprint: checked.fingerprint,
        reviewed_by: checked.by,
        reviewed_at: checked.at,
      },
      { onConflict: 'client_id,item' },
    )
    if (error) throw error

    return NextResponse.json({ checked })
  } catch (err) {
    console.error('[POST figures-checked]', err instanceof Error ? err.message : 'unknown')
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 })
  }
}
