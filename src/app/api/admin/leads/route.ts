import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { requireStaffUser, staffAuthorName } from '@/lib/auth/staff'
import { stateColumns } from '@/lib/leads/format'
import type { SubmissionPayload } from '@/lib/leads/ingestStore'

/**
 * Create a lead, optionally with its first activity.
 *
 * A known email is not refused: it becomes a new enquiry on the existing lead,
 * through the same `ingest_lead_submission` merge the forms use. The lead row
 * takes the new details and the earlier ones stay in Lead history. Answers 200
 * with `merged: true` and the existing lead's id in that case, 201 otherwise.
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

/**
 * The lead already on file for an email, if any — Add lead asks before
 * sending a known email in, because the POST below then merges rather than
 * creating. `?email=` is matched case-insensitively and exactly.
 */
export async function GET(req: NextRequest) {
  try {
    const staff = await requireStaffUser()
    if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const parsed = z.string().trim().email().safeParse(req.nextUrl.searchParams.get('email') ?? '')
    if (!parsed.success) return NextResponse.json({ error: 'Invalid email' }, { status: 400 })

    // ilike for case, with its wildcards escaped so it can only match exactly.
    const pattern = parsed.data.toLowerCase().replace(/[\\%_]/g, (char) => `\\${char}`)
    const { data, error } = await getSupabaseServerClient()
      .from('leads')
      .select('id, name, stage')
      .ilike('email', pattern)
      .limit(1)
      .maybeSingle()
    if (error) throw error

    return NextResponse.json({ lead: data ?? null })
  } catch (err) {
    console.error('[GET /api/admin/leads]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Failed to check email' }, { status: 500 })
  }
}

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
    let leadId = lead.id
    let merged = false
    if (insertError) {
      // One lead per email (migration 0020). Someone staff add again is a new
      // enquiry on that lead, not a second lead and not an error.
      if (insertError.code !== UNIQUE_VIOLATION || !insertError.message.includes(EMAIL_KEY)) {
        throw insertError
      }
      const author = staffAuthorName(staff)
      const submission: SubmissionPayload = {
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
        external_id: null,
      }
      const { data, error: mergeError } = await supabase.rpc('ingest_lead_submission', {
        p_submission: submission,
        p_note_body: `Added again by ${author}. The new details are on the lead; the earlier ones are in Lead history.`,
        p_note_author: author,
        p_latest_touch: false,
      })
      if (mergeError) throw mergeError
      const row = (data as { outcome: string; lead_id: string | null }[] | null)?.[0]
      if (!row?.lead_id) throw new Error('ingest_lead_submission returned no lead')
      leadId = row.lead_id
      merged = true
    }

    // Best effort: the lead exists either way, and losing an opening note is a
    // far smaller problem than losing the lead.
    if (activity) {
      const { error: activityError } = await supabase.from('lead_activities').insert({
        id: activity.id,
        lead_id: leadId,
        type: activity.type,
        body: activity.body,
        author: activity.author,
        created_at: activity.createdAt,
      })
      if (activityError) {
        console.error('[POST /api/admin/leads] activity insert failed:', activityError.message)
      }
    }

    return NextResponse.json({ id: leadId, merged }, { status: merged ? 200 : 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : JSON.stringify(err)
    console.error('[POST /api/admin/leads]', message, err)
    return NextResponse.json({ error: 'Failed to create lead', detail: message }, { status: 500 })
  }
}
