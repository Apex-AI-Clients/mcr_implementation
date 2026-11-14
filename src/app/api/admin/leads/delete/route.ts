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
 *  - Every client file the lead was converted into: its own link, and the
 *    file of each of its enquiries (0052), read before the delete because
 *    lead_submissions goes with the lead. Each leaves the SBR client list
 *    for the Archive (reason 'lead_deleted'), where staff can make it a client
 *    again or delete it permanently. Archived after the leads are deleted, and
 *    only for the leads actually deleted, so a failed delete archives nothing.
 *    A restored file has no lead to link back to. The UI says so before
 *    deleting a converted lead.
 *
 * Who deleted which lead, and when, is kept in lead_deletions (0053): the lead
 * id, its source, external id and stage, never a name, email or answer. It is
 * written before the delete, so no lead goes without its record; rows for
 * leads that were not deleted after all are taken out again.
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
    const by = staffAuthorName(staff)

    // The deletion record, before anything goes (0053).
    const { data: toDelete, error: readError } = await supabase
      .from('leads')
      .select('id, source, external_id, stage')
      .in('id', ids)
    if (readError) throw readError
    const logged = await recordDeletions(supabase, toDelete ?? [], by)
    if (logged === 'failed') {
      return NextResponse.json({ error: 'Could not record the deletion, so nothing was deleted.' }, { status: 500 })
    }

    // Read first: the enquiries, and their links, are deleted with the lead.
    const { data: enquiryFiles, error: enquiryError } = await supabase
      .from('lead_submissions')
      .select('lead_id, converted_client_id')
      .in('lead_id', ids)
      .not('converted_client_id', 'is', null)
    if (enquiryError) throw enquiryError

    const { data, error } = await supabase
      .from('leads')
      .delete()
      .in('id', ids)
      .select('id, converted_client_id')
    if (error) {
      if (logged === 'ok') await unrecord(supabase, ids)
      throw error
    }

    const deleted = data?.length ?? 0
    // Somebody else's delete got some first: their record is theirs.
    if (logged === 'ok' && deleted < (toDelete ?? []).length) {
      const gone = new Set((data ?? []).map((lead) => lead.id))
      await unrecord(supabase, (toDelete ?? []).map((lead) => lead.id).filter((id) => !gone.has(id)))
    }

    // Their client files go to the Archive. Ones already archived keep the
    // reason and date they were archived with.
    // Only for the leads actually deleted.
    const deletedIds = new Set((data ?? []).map((lead) => lead.id))
    const clientIds = [
      ...new Set([
        ...(data ?? []).map((lead) => lead.converted_client_id),
        ...(enquiryFiles ?? [])
          .filter((row) => deletedIds.has(row.lead_id))
          .map((row) => row.converted_client_id),
      ]),
    ].filter(Boolean) as string[]
    let archivedClients = 0
    if (clientIds.length > 0) {
      const { data: archived, error: archiveError } = await supabase
        .from('clients')
        .update(archiveUpdate('lead_deleted', by))
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

type Supabase = ReturnType<typeof getSupabaseServerClient>

/**
 * One lead_deletions row per lead about to be deleted. 'missing' before
 * migration 0053 adds the table: deleting goes ahead as it did before the log
 * existed, with a warning, rather than be blocked by a migration not yet run.
 */
async function recordDeletions(
  supabase: Supabase,
  leads: { id: string; source: string | null; external_id: string | null; stage: string | null }[],
  by: string,
): Promise<'ok' | 'missing' | 'failed'> {
  if (leads.length === 0) return 'ok'
  const { error } = await supabase.from('lead_deletions').insert(
    leads.map((lead) => ({
      lead_id: lead.id,
      source: lead.source,
      external_id: lead.external_id,
      stage: lead.stage,
      deleted_by: by,
    })),
  )
  if (!error) return 'ok'
  if (error.code === '42P01' || error.code === 'PGRST205') {
    console.warn('[POST /api/admin/leads/delete] lead_deletions missing (apply 0053): deleting without a record')
    return 'missing'
  }
  console.error('[POST /api/admin/leads/delete] lead_deletions insert failed:', error.message)
  return 'failed'
}

/** Takes the record back out for leads that were not deleted after all. */
async function unrecord(supabase: Supabase, leadIds: string[]): Promise<void> {
  if (leadIds.length === 0) return
  const { error } = await supabase.from('lead_deletions').delete().in('lead_id', leadIds)
  if (error) console.error('[POST /api/admin/leads/delete] lead_deletions cleanup failed:', error.message)
}
