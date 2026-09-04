import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { requireStaffUser } from '@/lib/auth/staff'
import type { Database } from '@/types/database'

/**
 * Update a lead, optionally alongside the activity that explains the change.
 *
 * Two rules the schema depends on:
 *
 *  - `last_action_at` is never written here. The trigger on lead_activities
 *    owns it, so a stage change (which carries a 'stage_change' activity)
 *    resets the follow-up clock, while correcting a phone number, a debt range
 *    or an entity type — none of which carry an activity — correctly leaves it
 *    alone.
 *  - `stage_since` is set server-side when the stage actually changes, so the
 *    client cannot get it wrong or backdate it.
 */

type LeadUpdate = Database['public']['Tables']['leads']['Update']

const ActivitySchema = z.object({
  id: z.string().uuid(),
  type: z.enum(['note', 'call', 'email', 'next_step', 'stage_change']),
  body: z.string().min(1),
  author: z.string().min(1),
  createdAt: z.string(),
})

/** Only what the UI can actually edit. Anything else is rejected, not ignored. */
const PatchSchema = z.object({
  email: z.string().email().optional(),
  phone: z.string().min(1).max(40).optional(),
  company: z.string().nullable().optional(),
  debtMin: z.number().int().min(0).nullable().optional(),
  debtMax: z.number().int().min(0).nullable().optional(),
  entityType: z.enum(['company', 'trust']).nullable().optional(),
  nextStep: z.string().nullable().optional(),
  stage: z
    .enum(['lead', 'prospect', 'client', 'converted', 'non_proceeding', 'do_not_contact'])
    .optional(),
  convertedClientId: z.string().uuid().nullable().optional(),
})

const BodySchema = z.object({
  patch: PatchSchema,
  activity: ActivitySchema.nullable().optional(),
})

interface Props {
  params: Promise<{ id: string }>
}

export async function PATCH(req: NextRequest, { params }: Props) {
  try {
    const staff = await requireStaffUser()
    if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    const parsed = BodySchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }
    const { patch, activity } = parsed.data

    const supabase = getSupabaseServerClient()

    const { data: existing, error: readError } = await supabase
      .from('leads')
      .select('id, stage, debt_min, debt_max')
      .eq('id', id)
      .maybeSingle()
    if (readError) throw readError
    if (!existing) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

    const update: LeadUpdate = {}
    if (patch.email !== undefined) update.email = patch.email.trim().toLowerCase()
    if (patch.phone !== undefined) update.phone = patch.phone.trim()
    if (patch.company !== undefined) update.company = patch.company
    if (patch.debtMin !== undefined) update.debt_min = patch.debtMin
    if (patch.debtMax !== undefined) update.debt_max = patch.debtMax
    if (patch.entityType !== undefined) update.entity_type = patch.entityType
    if (patch.nextStep !== undefined) update.next_step = patch.nextStep
    if (patch.convertedClientId !== undefined) {
      update.converted_client_id = patch.convertedClientId
    }
    if (patch.stage !== undefined) {
      update.stage = patch.stage
      // Only restart the clock on an actual move.
      if (patch.stage !== existing.stage) update.stage_since = new Date().toISOString()
    }

    // Validate the resulting range, not just the incoming half of it.
    const nextMin = update.debt_min !== undefined ? update.debt_min : existing.debt_min
    const nextMax = update.debt_max !== undefined ? update.debt_max : existing.debt_max
    if (nextMin !== null && nextMax !== null && nextMax < nextMin) {
      return NextResponse.json({ error: 'Debt range is inverted' }, { status: 400 })
    }

    if (Object.keys(update).length > 0) {
      const { error: updateError } = await supabase.from('leads').update(update).eq('id', id)
      if (updateError) throw updateError
    }

    // Inserted after the update so the trigger stamps the clock last.
    if (activity) {
      const { error: activityError } = await supabase.from('lead_activities').insert({
        id: activity.id,
        lead_id: id,
        type: activity.type,
        body: activity.body,
        author: activity.author,
        created_at: activity.createdAt,
      })
      if (activityError) throw activityError
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : JSON.stringify(err)
    console.error('[PATCH /api/admin/leads/[id]]', message, err)
    return NextResponse.json({ error: 'Failed to update lead', detail: message }, { status: 500 })
  }
}
