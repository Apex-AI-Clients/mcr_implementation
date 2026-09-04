import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { requireStaffUser } from '@/lib/auth/staff'

/**
 * Create a lead, optionally with its first activity.
 *
 * `last_action_at` is deliberately absent from the insert — the trigger on
 * lead_activities owns that column. Two writers to one clock is how it drifts.
 */

const ActivitySchema = z.object({
  id: z.string().uuid(),
  type: z.enum(['note', 'call', 'email', 'next_step', 'stage_change']),
  body: z.string().min(1),
  author: z.string().min(1),
  createdAt: z.string(),
})

const LeadSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200),
  email: z.string().email(),
  phone: z.string().min(1).max(40),
  debtMin: z.number().int().min(0).nullable(),
  debtMax: z.number().int().min(0).nullable(),
  state: z.enum(['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT']),
  entityType: z.enum(['company', 'trust']).nullable(),
  message: z.string().nullable(),
  preferredCallTime: z.string().nullable(),
  source: z.enum(['facebook', 'website', 'google_form', 'manual']),
  company: z.string().nullable(),
})

const BodySchema = z.object({
  lead: LeadSchema,
  activity: ActivitySchema.nullable().optional(),
})

export async function POST(req: NextRequest) {
  try {
    const staff = await requireStaffUser()
    if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const parsed = BodySchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }
    const { lead, activity } = parsed.data

    if (lead.debtMin !== null && lead.debtMax !== null && lead.debtMax < lead.debtMin) {
      return NextResponse.json({ error: 'Debt range is inverted' }, { status: 400 })
    }

    const supabase = getSupabaseServerClient()

    const { error: insertError } = await supabase.from('leads').insert({
      id: lead.id,
      name: lead.name.trim(),
      email: lead.email.trim().toLowerCase(),
      phone: lead.phone.trim(),
      debt_min: lead.debtMin,
      debt_max: lead.debtMax,
      state: lead.state,
      entity_type: lead.entityType,
      message: lead.message,
      preferred_call_time: lead.preferredCallTime,
      source: lead.source,
      company: lead.company,
      stage: 'lead',
    })
    if (insertError) throw insertError

    // Best effort: the lead exists either way, and losing an opening note is a
    // far smaller problem than losing the lead.
    if (activity) {
      const { error: activityError } = await supabase.from('lead_activities').insert({
        id: activity.id,
        lead_id: lead.id,
        type: activity.type,
        body: activity.body,
        author: activity.author,
        created_at: activity.createdAt,
      })
      if (activityError) {
        console.error('[POST /api/admin/leads] activity insert failed:', activityError.message)
      }
    }

    return NextResponse.json({ id: lead.id }, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : JSON.stringify(err)
    console.error('[POST /api/admin/leads]', message, err)
    return NextResponse.json({ error: 'Failed to create lead', detail: message }, { status: 500 })
  }
}
