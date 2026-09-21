import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { requireStaffUser } from '@/lib/auth/staff'

export const dynamic = 'force-dynamic'

/**
 * Edit or delete one entry on a lead's timeline.
 *
 * Only entries a person composed. A `stage_change` is the system's record
 * that something happened, and rewriting or removing it would leave the
 * timeline disagreeing with the stage it produced — a mistaken stage change
 * is corrected by changing the stage again, which records that too.
 *
 * Neither verb touches `last_action_at`. The trigger owns that column and
 * fires on insert; editing the text of a note is not a new action, so the
 * follow-up clock is right to ignore it. Deleting is the awkward case — see
 * the note on DELETE.
 *
 * `next_step` is mirrored onto `leads.next_step` so the record can show the
 * current one without scanning the timeline, which means both verbs have to
 * keep that mirror honest.
 */

const PatchSchema = z.object({
  body: z.string().min(1).max(5000),
})

interface Props {
  params: Promise<{ id: string; activityId: string }>
}

const COMPOSED_TYPES = ['note', 'call', 'email', 'next_step']

/** The most recent `next_step` on a lead, which is the one the record shows. */
async function latestNextStepId(
  supabase: ReturnType<typeof getSupabaseServerClient>,
  leadId: string,
): Promise<{ id: string; body: string } | null> {
  const { data } = await supabase
    .from('lead_activities')
    .select('id, body')
    .eq('lead_id', leadId)
    .eq('type', 'next_step')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data ?? null
}

/** Load the activity and check it is one this lead owns and a person wrote. */
async function loadEditable(
  supabase: ReturnType<typeof getSupabaseServerClient>,
  leadId: string,
  activityId: string,
) {
  const { data, error } = await supabase
    .from('lead_activities')
    .select('id, lead_id, type')
    .eq('id', activityId)
    .maybeSingle()

  if (error) throw error
  if (!data) return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  // Checked rather than assumed: the id comes from the client, and without
  // this an activity could be edited through any lead's URL.
  if (data.lead_id !== leadId) {
    return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  }
  if (!COMPOSED_TYPES.includes(data.type)) {
    return {
      error: NextResponse.json(
        { error: 'Stage changes are a record of what happened and cannot be edited' },
        { status: 400 },
      ),
    }
  }
  return { activity: data }
}

export async function PATCH(req: NextRequest, { params }: Props) {
  try {
    const staff = await requireStaffUser()
    if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id, activityId } = await params
    const parsed = PatchSchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    const supabase = getSupabaseServerClient()
    const loaded = await loadEditable(supabase, id, activityId)
    if (loaded.error) return loaded.error

    const body = parsed.data.body.trim()
    const { error } = await supabase
      .from('lead_activities')
      .update({ body })
      .eq('id', activityId)
    if (error) throw error

    // Keep the mirrored next step in step with its activity, but only when
    // this is the one the record is actually showing.
    if (loaded.activity.type === 'next_step') {
      const latest = await latestNextStepId(supabase, id)
      if (latest?.id === activityId) {
        const { error: stepError } = await supabase
          .from('leads')
          .update({ next_step: body })
          .eq('id', id)
        if (stepError) throw stepError
      }
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : JSON.stringify(err)
    console.error('[PATCH /api/admin/leads/[id]/activities/[activityId]]', message, err)
    return NextResponse.json({ error: 'Failed to update', detail: message }, { status: 500 })
  }
}

/**
 * Delete one entry.
 *
 * Known consequence: `last_action_at` is not wound back. The trigger that
 * maintains it fires on insert, so a lead whose most recent entry is deleted
 * keeps a follow-up clock set by an entry that no longer exists — it looks
 * more recently worked than it is, until the threshold passes anyway. Fixing
 * that means a second writer to a column the schema deliberately gives one
 * owner, so it is left alone and written down instead.
 */
export async function DELETE(req: NextRequest, { params }: Props) {
  try {
    const staff = await requireStaffUser()
    if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id, activityId } = await params
    const supabase = getSupabaseServerClient()

    const loaded = await loadEditable(supabase, id, activityId)
    if (loaded.error) return loaded.error

    const wasCurrentNextStep =
      loaded.activity.type === 'next_step' &&
      (await latestNextStepId(supabase, id))?.id === activityId

    const { error } = await supabase.from('lead_activities').delete().eq('id', activityId)
    if (error) throw error

    // The record showed this one, so it has to fall back to whatever is left
    // rather than keep displaying a next step nobody can find.
    if (wasCurrentNextStep) {
      const remaining = await latestNextStepId(supabase, id)
      const { error: stepError } = await supabase
        .from('leads')
        .update({ next_step: remaining?.body ?? null })
        .eq('id', id)
      if (stepError) throw stepError
    }

    console.info(`[DELETE activity] ${activityId} on lead ${id} by ${staff.id}`)
    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : JSON.stringify(err)
    console.error('[DELETE /api/admin/leads/[id]/activities/[activityId]]', message, err)
    return NextResponse.json({ error: 'Failed to delete', detail: message }, { status: 500 })
  }
}
