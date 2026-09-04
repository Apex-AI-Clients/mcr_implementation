import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { requireStaffUser } from '@/lib/auth/staff'

/**
 * Record an activity against a lead.
 *
 * This is the only thing that resets the follow-up clock, and it does so
 * through the trigger on insert rather than by writing `last_action_at` here.
 * A "next step" also lands on the lead itself so the record can show the
 * current one without scanning the timeline.
 */

const BodySchema = z.object({
  activity: z.object({
    id: z.string().uuid(),
    type: z.enum(['note', 'call', 'email', 'next_step', 'stage_change']),
    body: z.string().min(1),
    author: z.string().min(1),
    createdAt: z.string(),
  }),
})

interface Props {
  params: Promise<{ id: string }>
}

export async function POST(req: NextRequest, { params }: Props) {
  try {
    const staff = await requireStaffUser()
    if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    const parsed = BodySchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }
    const { activity } = parsed.data

    const supabase = getSupabaseServerClient()

    const { error: insertError } = await supabase.from('lead_activities').insert({
      id: activity.id,
      lead_id: id,
      type: activity.type,
      body: activity.body,
      author: activity.author,
      created_at: activity.createdAt,
    })
    if (insertError) throw insertError

    if (activity.type === 'next_step') {
      const { error: stepError } = await supabase
        .from('leads')
        .update({ next_step: activity.body })
        .eq('id', id)
      if (stepError) throw stepError
    }

    return NextResponse.json({ ok: true }, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : JSON.stringify(err)
    console.error('[POST /api/admin/leads/[id]/activities]', message, err)
    return NextResponse.json({ error: 'Failed to record activity', detail: message }, { status: 500 })
  }
}
