import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { requireStaffUser } from '@/lib/auth/staff'

export const dynamic = 'force-dynamic'

/**
 * Delete leads, permanently.
 *
 * One endpoint for one lead or fifty: the row icon, the bulk bar and the
 * record page all post here, so the rules below are enforced in exactly one
 * place rather than three.
 *
 * What goes with a lead:
 *
 *  - Its activities. `lead_activities.lead_id` is ON DELETE CASCADE, so the
 *    whole timeline goes too. That is the intent — an orphaned timeline helps
 *    nobody — but it is not recoverable.
 *  - Its Meta attribution. The ad, campaign and form ids captured at ingest
 *    cannot be re-fetched from a leadgen id we have already consumed, so a
 *    deleted lead's attribution is gone for good.
 *
 * What does NOT go:
 *
 *  - A client file the lead was converted into. That FK points the other way
 *    (`converted_client_id` is ON DELETE SET NULL on the clients side), so the
 *    file survives — but the "Converted from a lead" link on it disappears,
 *    because that link is resolved by querying leads. The UI warns before
 *    deleting a converted lead for this reason.
 *
 * This is a hard delete, as asked for. If these ever need to be recoverable,
 * the change is a `deleted_at` column and a filter in getLeadsPage, not a
 * change here.
 */

/** A ceiling, so a malformed client cannot ask to empty the table in one call. */
const MAX_IDS = 100

const BodySchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(MAX_IDS),
})

export async function POST(req: NextRequest) {
  try {
    const staff = await requireStaffUser()
    if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const parsed = BodySchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    // De-duplicated: the same id twice is harmless to Postgres but would make
    // the reported count a lie.
    const ids = [...new Set(parsed.data.ids)]
    const supabase = getSupabaseServerClient()

    const { data, error } = await supabase.from('leads').delete().in('id', ids).select('id')
    if (error) throw error

    const deleted = data?.length ?? 0
    // Fewer rows than ids means somebody else got there first. Not an error —
    // the caller wanted them gone and they are gone — but worth the log line.
    if (deleted !== ids.length) {
      console.warn(
        `[POST /api/admin/leads/delete] asked for ${ids.length}, deleted ${deleted}`,
      )
    }
    console.info(`[POST /api/admin/leads/delete] ${deleted} lead(s) deleted by ${staff.id}`)

    return NextResponse.json({ deleted })
  } catch (err) {
    const message = err instanceof Error ? err.message : JSON.stringify(err)
    console.error('[POST /api/admin/leads/delete]', message, err)
    return NextResponse.json({ error: 'Failed to delete', detail: message }, { status: 500 })
  }
}
