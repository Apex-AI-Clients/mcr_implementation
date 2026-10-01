import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { requireStaffUser, staffAuthorName } from '@/lib/auth/staff'
import { archiveUpdate } from '@/lib/clients/archive'

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
 * What is archived, not deleted:
 *
 *  - A client file the lead was converted into. It leaves the SBR client list
 *    for the Archive (reason 'lead_deleted'), where staff can make it a client
 *    again or delete it permanently. Archived after the leads are deleted, and
 *    only for the leads actually deleted, so a failed delete archives nothing.
 *    A restored file has no lead to link back to. The UI says so before
 *    deleting a converted lead.
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

    const { data, error } = await supabase
      .from('leads')
      .delete()
      .in('id', ids)
      .select('id, converted_client_id')
    if (error) throw error

    const deleted = data?.length ?? 0

    // Their client files go to the Archive. Ones already archived keep the
    // reason and date they were archived with.
    const clientIds = [
      ...new Set((data ?? []).map((lead) => lead.converted_client_id).filter(Boolean)),
    ] as string[]
    let archivedClients = 0
    if (clientIds.length > 0) {
      const { data: archived, error: archiveError } = await supabase
        .from('clients')
        .update(archiveUpdate('lead_deleted', staffAuthorName(staff)))
        .in('id', clientIds)
        .is('archived_at', null)
        .select('id')
      if (archiveError) {
        // The leads are gone either way. Their files stay on the client list,
        // which is how it worked before the Archive, and can be archived by hand.
        console.error('[POST /api/admin/leads/delete] archive failed:', archiveError.message)
        return NextResponse.json({ deleted, archivedClients: 0, archiveFailed: true })
      }
      archivedClients = archived?.length ?? 0
    }
    // Fewer rows than ids means somebody else got there first. Not an error —
    // the caller wanted them gone and they are gone — but worth the log line.
    if (deleted !== ids.length) {
      console.warn(
        `[POST /api/admin/leads/delete] asked for ${ids.length}, deleted ${deleted}`,
      )
    }
    console.info(`[POST /api/admin/leads/delete] ${deleted} lead(s) deleted by ${staff.id}`)

    return NextResponse.json({ deleted, archivedClients })
  } catch (err) {
    const message = err instanceof Error ? err.message : JSON.stringify(err)
    console.error('[POST /api/admin/leads/delete]', message, err)
    return NextResponse.json({ error: 'Failed to delete', detail: message }, { status: 500 })
  }
}
