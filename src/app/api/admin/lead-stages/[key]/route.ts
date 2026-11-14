import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { requireStaffUser } from '@/lib/auth/staff'
import { ALL_STAGES, isCustomStage } from '@/lib/leads/constants'
import { rowToStage, STAGE_LABEL_MAX } from '@/lib/leads/customStages'
import { builtInStageNamed } from '@/lib/leads/stageNames'

/**
 * Rename a stage: one staff added, or a built-in one (0055). The name is used
 * for its tab and the stage everywhere. The old name is kept in
 * former_labels, so activity entries written under it still read back to the
 * stage. Deleting a stage staff added is ./delete.
 *
 * The built-in stages' default names stay reserved: no other stage can take
 * "Prospect", so an old "Stage before: Prospect." entry never points at the
 * wrong stage. A built-in stage can take its own default name back.
 */

const BodySchema = z.object({
  label: z.string().trim().min(1, 'Give the stage a name').max(STAGE_LABEL_MAX, `Keep it to ${STAGE_LABEL_MAX} characters`),
})

interface Props {
  params: Promise<{ key: string }>
}

export async function PATCH(req: NextRequest, { params }: Props) {
  try {
    const staff = await requireStaffUser()
    if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { key } = await params
    if (!isCustomStage(key) && !(ALL_STAGES as string[]).includes(key)) {
      return NextResponse.json({ error: 'Stage not found' }, { status: 404 })
    }
    const parsed = BodySchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    const supabase = getSupabaseServerClient()
    // All columns: former_labels arrives with 0055.
    const { data: existing, error: readError } = await supabase.from('lead_stages').select('*').eq('key', key).maybeSingle()
    if (readError) throw readError
    if (!existing || existing.built_in !== !isCustomStage(key)) {
      return NextResponse.json({ error: 'Stage not found' }, { status: 404 })
    }

    const label = parsed.data.label.replace(/\s+/g, ' ')
    const reserved = builtInStageNamed(label)
    if (reserved && reserved !== key) {
      return NextResponse.json({ error: `"${label}" is already a stage` }, { status: 409 })
    }
    if (label === existing.label) return NextResponse.json({ stage: rowToStage(existing) })

    const row = existing as typeof existing & { former_labels?: string[] }
    const former = row.former_labels
    const update = former === undefined
      ? { label }
      : { label, former_labels: former.includes(existing.label) ? former : [...former, existing.label] }
    const { data: renamed, error: renameError } = await supabase
      .from('lead_stages')
      .update(update)
      .eq('key', key)
      .select('*')
      .single()
    if (renameError) {
      if (renameError.code === '23505') {
        return NextResponse.json({ error: `"${label}" is already a stage` }, { status: 409 })
      }
      throw renameError
    }
    return NextResponse.json({ stage: rowToStage(renamed) })
  } catch (err) {
    console.error('[PATCH /api/admin/lead-stages/[key]]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Could not change the stage' }, { status: 500 })
  }
}
