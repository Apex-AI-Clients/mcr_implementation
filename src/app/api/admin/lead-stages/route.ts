import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { requireStaffUser, staffAuthorName } from '@/lib/auth/staff'
import { rowToCustomStage, STAGE_LABEL_MAX } from '@/lib/leads/customStages'
import { builtInStageNamed } from '@/lib/leads/stageNames'

/**
 * Add a stage by typing its name. It gets its own tab on the Leads page.
 *
 *  - The name can't be a built-in stage's (now or as it was called before
 *    0042), nor another custom stage's, whatever the case.
 *  - Typing the name of a hidden stage brings that stage back rather than
 *    making a second one: it keeps its key, so old activity entries naming it
 *    still read right.
 */

const BodySchema = z.object({
  label: z.string().trim().min(1, 'Give the stage a name').max(STAGE_LABEL_MAX, `Keep it to ${STAGE_LABEL_MAX} characters`),
})

export async function POST(req: NextRequest) {
  try {
    const staff = await requireStaffUser()
    if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const parsed = BodySchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }
    const label = parsed.data.label.replace(/\s+/g, ' ')

    if (builtInStageNamed(label)) {
      return NextResponse.json({ error: `"${label}" is already a stage` }, { status: 409 })
    }

    const supabase = getSupabaseServerClient()
    const { data: rows, error: readError } = await supabase
      .from('lead_stages')
      .select('key, label, position, hidden_at, built_in')
    if (readError) throw readError

    const same = (rows ?? []).find((row) => row.label.trim().toLowerCase() === label.toLowerCase())
    if (same && !same.built_in && same.hidden_at) {
      const { data: shown, error } = await supabase
        .from('lead_stages')
        .update({ hidden_at: null })
        .eq('key', same.key)
        .select('key, label, position, hidden_at')
        .single()
      if (error) throw error
      return NextResponse.json({ stage: rowToCustomStage(shown) }, { status: 200 })
    }
    if (same) {
      return NextResponse.json({ error: `"${same.label}" is already a stage` }, { status: 409 })
    }

    const position = Math.max(0, ...(rows ?? []).filter((row) => !row.built_in).map((row) => row.position)) + 1
    const { data: created, error: insertError } = await supabase
      .from('lead_stages')
      .insert({
        key: `custom_${randomUUID().replace(/-/g, '').slice(0, 8)}`,
        label,
        built_in: false,
        position,
        created_by: staffAuthorName(staff),
      })
      .select('key, label, position, hidden_at')
      .single()
    if (insertError) {
      // The unique index on the name: somebody added it a moment ago.
      if (insertError.code === '23505') {
        return NextResponse.json({ error: `"${label}" is already a stage` }, { status: 409 })
      }
      throw insertError
    }

    return NextResponse.json({ stage: rowToCustomStage(created) }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/admin/lead-stages]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Could not add the stage' }, { status: 500 })
  }
}
