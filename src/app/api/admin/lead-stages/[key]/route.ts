import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { requireStaffUser } from '@/lib/auth/staff'
import { isCustomStage } from '@/lib/leads/constants'
import { rowToCustomStage, STAGE_LABEL_MAX } from '@/lib/leads/customStages'
import { builtInStageNamed } from '@/lib/leads/stageNames'

/**
 * Rename or hide a stage staff added. Built-in stages are neither.
 *
 * Hiding is refused while any lead is in the stage, so no lead is ever left
 * in a stage with no tab. The row stays (hidden_at set): its name still reads
 * on old activity entries, and adding the name again brings it back.
 */

const BodySchema = z.union([
  z.object({
    label: z.string().trim().min(1, 'Give the stage a name').max(STAGE_LABEL_MAX, `Keep it to ${STAGE_LABEL_MAX} characters`),
  }),
  z.object({ hidden: z.literal(true) }),
])

interface Props {
  params: Promise<{ key: string }>
}

export async function PATCH(req: NextRequest, { params }: Props) {
  try {
    const staff = await requireStaffUser()
    if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { key } = await params
    if (!isCustomStage(key)) {
      return NextResponse.json({ error: 'Only stages added by staff can be changed' }, { status: 400 })
    }
    const parsed = BodySchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    const supabase = getSupabaseServerClient()
    const { data: existing, error: readError } = await supabase
      .from('lead_stages')
      .select('key, built_in')
      .eq('key', key)
      .maybeSingle()
    if (readError) throw readError
    if (!existing || existing.built_in) return NextResponse.json({ error: 'Stage not found' }, { status: 404 })

    if ('hidden' in parsed.data) {
      const { count, error: countError } = await supabase
        .from('leads')
        .select('id', { count: 'exact', head: true })
        .eq('stage', key)
      if (countError) throw countError
      if ((count ?? 0) > 0) {
        return NextResponse.json(
          { error: `Move its ${count} lead${count === 1 ? '' : 's'} to another stage first` },
          { status: 409 },
        )
      }
      const { data: hidden, error } = await supabase
        .from('lead_stages')
        .update({ hidden_at: new Date().toISOString() })
        .eq('key', key)
        .select('key, label, position, hidden_at')
        .single()
      if (error) throw error
      return NextResponse.json({ stage: rowToCustomStage(hidden) })
    }

    const label = parsed.data.label.replace(/\s+/g, ' ')
    if (builtInStageNamed(label)) {
      return NextResponse.json({ error: `"${label}" is already a stage` }, { status: 409 })
    }
    const { data: renamed, error: renameError } = await supabase
      .from('lead_stages')
      .update({ label })
      .eq('key', key)
      .select('key, label, position, hidden_at')
      .single()
    if (renameError) {
      if (renameError.code === '23505') {
        return NextResponse.json({ error: `"${label}" is already a stage` }, { status: 409 })
      }
      throw renameError
    }
    return NextResponse.json({ stage: rowToCustomStage(renamed) })
  } catch (err) {
    console.error('[PATCH /api/admin/lead-stages/[key]]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Could not change the stage' }, { status: 500 })
  }
}
