import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { requireStaffUser, staffAuthorName } from '@/lib/auth/staff'
import { ALL_STAGES, isCustomStage, stageLabel } from '@/lib/leads/constants'
import type { BuiltInStage, CustomStageKey, LeadStage } from '@/types/leads'

/**
 * Delete a stage staff added. Built-in stages can't be deleted.
 *
 * A stage with leads in it needs somewhere for them to go (`moveTo`): they are
 * moved there first, each with a "Stage changed" entry, as if moved by hand, so
 * no lead is ever left pointing at a stage that is gone. Not to Client: that
 * means making a client file, one lead at a time.
 *
 * Posts to an explicit /delete path rather than using the DELETE verb, because
 * this carries a body and a DELETE with a body is inconsistently handled
 * across proxies (as /api/admin/leads/delete).
 *
 * Old activity entries keep the deleted stage's name: they are text.
 */

const BodySchema = z.object({
  moveTo: z
    .union([
      z.enum(ALL_STAGES as [BuiltInStage, ...BuiltInStage[]]),
      z.string().regex(/^custom_[a-z0-9]+$/, 'Unknown stage') as z.ZodType<CustomStageKey>,
    ])
    .optional(),
})

interface Props {
  params: Promise<{ key: string }>
}

export async function POST(req: NextRequest, { params }: Props) {
  try {
    const staff = await requireStaffUser()
    if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { key } = await params
    if (!isCustomStage(key)) {
      return NextResponse.json({ error: 'Only stages added by staff can be deleted' }, { status: 400 })
    }
    const parsed = BodySchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }
    const { moveTo } = parsed.data
    if (moveTo === key) {
      return NextResponse.json({ error: 'Choose another stage for its leads' }, { status: 400 })
    }
    if (moveTo === 'client') {
      return NextResponse.json({ error: 'Leads become clients one at a time. Choose another stage.' }, { status: 400 })
    }

    const supabase = getSupabaseServerClient()
    const { data: existing, error: readError } = await supabase
      .from('lead_stages')
      .select('key, label, built_in')
      .eq('key', key)
      .maybeSingle()
    if (readError) throw readError
    if (!existing || existing.built_in) return NextResponse.json({ error: 'Stage not found' }, { status: 404 })

    let toLabel: string | null = null
    if (moveTo && isCustomStage(moveTo)) {
      const { data: target, error: targetError } = await supabase
        .from('lead_stages')
        .select('label')
        .eq('key', moveTo)
        .is('hidden_at', null)
        .maybeSingle()
      if (targetError) throw targetError
      if (!target) return NextResponse.json({ error: 'That stage no longer exists' }, { status: 400 })
      toLabel = target.label
    } else if (moveTo) {
      toLabel = stageLabel(moveTo, [])
    }

    let moved = 0
    if (moveTo) {
      const { data: movedRows, error: moveError } = await supabase
        .from('leads')
        .update({ stage: moveTo as LeadStage, stage_since: new Date().toISOString() })
        .eq('stage', key)
        .select('id')
      if (moveError) throw moveError
      moved = movedRows?.length ?? 0

      // After the move, so the trigger on lead_activities stamps the clock last.
      if (moved > 0) {
        const author = staffAuthorName(staff)
        const body = `Stage changed from ${existing.label} to ${toLabel}.`
        const { error: activityError } = await supabase.from('lead_activities').insert(
          (movedRows ?? []).map((row) => ({ lead_id: row.id, type: 'stage_change', body, author })),
        )
        if (activityError) throw activityError
      }
    } else {
      const { count, error: countError } = await supabase
        .from('leads')
        .select('id', { count: 'exact', head: true })
        .eq('stage', key)
      if (countError) throw countError
      if ((count ?? 0) > 0) {
        return NextResponse.json(
          { error: `Choose a stage for its ${count} lead${count === 1 ? '' : 's'}` },
          { status: 409 },
        )
      }
    }

    const { error: deleteError } = await supabase.from('lead_stages').delete().eq('key', key)
    if (deleteError) {
      // leads_stage_fkey: somebody moved a lead into it a moment ago.
      if (deleteError.code === '23503') {
        return NextResponse.json({ error: 'A lead was just moved into this stage. Try again.' }, { status: 409 })
      }
      throw deleteError
    }
    return NextResponse.json({ ok: true, moved })
  } catch (err) {
    console.error('[POST /api/admin/lead-stages/[key]/delete]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Could not delete the stage' }, { status: 500 })
  }
}
