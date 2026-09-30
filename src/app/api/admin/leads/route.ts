import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { requireStaffUser } from '@/lib/auth/staff'
import { stateColumns } from '@/lib/leads/format'

/**
 * Create a lead, optionally with its first activity.
 *
 * `last_action_at` is deliberately absent from the insert — the trigger on
 * lead_activities owns that column. Two writers to one clock is how it drifts.
 */

/** Postgres unique-violation, and the index that makes emails unique. */
const UNIQUE_VIOLATION = '23505'
const EMAIL_KEY = 'leads_email_lower_key'

const ActivitySchema = z.object({
  id: z.string().uuid(),
  type: z.enum(['note', 'call', 'email', 'next_step', 'stage_change']),
  body: z.string().min(1),
  author: z.string().min(1),
  createdAt: z.string(),
})

const StateSchema = z.enum(['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'])

const LeadSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200),
  email: z.string().email(),
  phone: z.string().min(1).max(40),
  debtMin: z.number().int().min(0).nullable(),
  debtMax: z.number().int().min(0).nullable(),
  /** The one state, or null when several were chosen (see stateOptions). */
  state: StateSchema.nullable(),
  /** Two or more states ticked in Add lead. Exactly one of this and `state` is set. */
  stateOptions: z.array(StateSchema).min(2).max(8).nullable().optional(),
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

    // One state, or a list of them — never both and never neither. The columns
    // (and the text shown for a list) are worked out here from the states
    // themselves, so the request cannot store a label that disagrees with them.
    const states = lead.state ? [lead.state] : (lead.stateOptions ?? [])
    if (lead.state && lead.stateOptions?.length) {
      return NextResponse.json({ error: 'Send one state or a list, not both' }, { status: 400 })
    }
    const stateFields = stateColumns(states)
    if (!stateFields.state && !stateFields.metaStateOptions) {
      return NextResponse.json({ error: 'Choose a state' }, { status: 400 })
    }

    const supabase = getSupabaseServerClient()
    const email = lead.email.trim().toLowerCase()

    // A trigger adds the lead's first submission (source 'manual') in the same
    // transaction, so there is nothing to write for it here.
    const { error: insertError } = await supabase.from('leads').insert({
      id: lead.id,
      name: lead.name.trim(),
      email,
      phone: lead.phone.trim(),
      debt_min: lead.debtMin,
      debt_max: lead.debtMax,
      state: stateFields.state,
      meta_state_raw: stateFields.metaStateRaw,
      meta_state_options: stateFields.metaStateOptions,
      entity_type: lead.entityType,
      message: lead.message,
      preferred_call_time: lead.preferredCallTime,
      source: lead.source,
      company: lead.company,
      stage: 'lead',
    })
    if (insertError) {
      // One lead per email (migration 0020). Staff adding someone who already
      // enquired get the existing record to open, never a silent merge.
      if (insertError.code === UNIQUE_VIOLATION && insertError.message.includes(EMAIL_KEY)) {
        const { data: existing } = await supabase
          .from('leads')
          .select('id')
          .eq('email', email)
          .maybeSingle()
        return NextResponse.json(
          { error: 'A lead with this email already exists.', leadId: existing?.id ?? null },
          { status: 409 },
        )
      }
      throw insertError
    }

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
