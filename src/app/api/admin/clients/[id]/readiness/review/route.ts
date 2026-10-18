import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { requireStaffUser, staffAuthorName } from '@/lib/auth/staff'
import { loadReadiness } from '@/lib/sbr/loadReadiness'

/**
 * POST — staff marking a "Needs review" readiness item as reviewed.
 *
 * What was reviewed is worked out here, from the data as it is now (its
 * fingerprint), never taken from the request. The review counts only while
 * that data is unchanged: a new file, a re-read or a rebuilt comparison needs
 * a new review.
 */

interface Params {
  params: Promise<{ id: string }>
}

const BodySchema = z.object({ item: z.enum(['financials', 'lodgement', 'dpn']) })

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const staff = await requireStaffUser()
    if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id: clientId } = await params
    const parsed = BodySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

    const supabase = getSupabaseServerClient()
    const readiness = await loadReadiness(supabase, clientId)
    const item = readiness.items.find((i) => i.key === parsed.data.item)
    if (!item || item.status !== 'needs_review' || !item.fingerprint) {
      return NextResponse.json({ error: 'There is nothing to review here now.' }, { status: 409 })
    }

    const { error } = await supabase.from('sbr_readiness_reviews').upsert(
      {
        client_id: clientId,
        item: item.key,
        fingerprint: item.fingerprint,
        reviewed_by: staffAuthorName(staff),
        reviewed_at: new Date().toISOString(),
      },
      { onConflict: 'client_id,item' },
    )
    if (error) throw error

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[POST readiness/review]', err instanceof Error ? err.message : 'unknown')
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 })
  }
}
