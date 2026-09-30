import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServerClient, getSupabaseAuthClient } from '@/lib/supabase/server'
import { z } from 'zod'
import { normaliseClientPhone } from '@/lib/clients/phone'
import { CompanyDetailsSchema, companyDetailsInsert } from '@/lib/clients/companyDetails'
import { staffAuthorName } from '@/lib/auth/staff'
import { CONVERSION_ACTIVITY_BODY } from '@/lib/leads/constants'

/**
 * Step 2 of the intake, optionally supplied at creation.
 *
 * Every field is optional here because this endpoint serves two callers: the
 * intake wizard, which creates a bare client and fills these in later, and
 * lead conversion, which will not let anyone through without them. Which
 * fields are required is a decision about the conversion form, not about
 * what a client row is allowed to look like — see conversionForm.ts. The
 * schema itself is shared with the intake route (src/lib/clients/companyDetails.ts).
 */

const CreateClientSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email(),
  /** The contact's own number — not the company line in companyDetails. */
  phone: z.string().max(40).optional(),
  companyDetails: CompanyDetailsSchema.optional(),
  /**
   * The lead this client file is being created from. When given, the lead is
   * marked converted and linked here, in this request — not in a second one
   * from the browser. A page reload, a closed tab or a dropped connection
   * between two requests used to leave a client file whose lead still said
   * "lead" and still offered to convert.
   */
  leadId: z.string().uuid().optional(),
})

/**
 * Single-role model: any authenticated user is staff. Clients no longer log in,
 * so there is no role to check — just require a session.
 */
async function requireStaff() {
  const authClient = await getSupabaseAuthClient()
  const {
    data: { user },
    error,
  } = await authClient.auth.getUser()
  if (error) console.error('[requireStaff] auth error:', error.message)
  return user ?? null
}

export async function GET() {
  try {
    const staff = await requireStaff()
    if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const supabase = getSupabaseServerClient()
    const { data, error } = await supabase
      .from('clients')
      .select('id, name, email, status, created_at, updated_at')
      .order('created_at', { ascending: false })

    if (error) throw error
    return NextResponse.json(data)
  } catch (err) {
    const message = err instanceof Error ? err.message : JSON.stringify(err)
    console.error('[GET /api/admin/clients]', message, err)
    return NextResponse.json({ error: 'Failed to fetch clients', detail: message }, { status: 500 })
  }
}

/**
 * Create a client record. No Supabase auth user, no invite email — the email is
 * just a stored contact field. Staff then complete the intake wizard for the
 * returned client id.
 */
export async function POST(req: NextRequest) {
  try {
    const staff = await requireStaff()
    if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const parsed = CreateClientSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    const name = parsed.data.name.trim()
    const email = parsed.data.email.trim().toLowerCase()
    const phone = normaliseClientPhone(parsed.data.phone)
    const supabase = getSupabaseServerClient()
    const leadId = parsed.data.leadId

    // Before anything is created: a lead that is not there cannot be converted.
    let leadStage: string | null = null
    if (leadId) {
      const { data: lead, error: leadError } = await supabase
        .from('leads')
        .select('id, stage')
        .eq('id', leadId)
        .maybeSingle()
      if (leadError) throw leadError
      if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
      leadStage = lead.stage
    }

    const { data: existing } = await supabase
      .from('clients')
      .select('id')
      .eq('email', email)
      .maybeSingle()
    if (existing) {
      return NextResponse.json(
        { error: 'A client with this email already exists', clientId: existing.id },
        { status: 409 },
      )
    }

    const { data: client, error: insertError } = await supabase
      .from('clients')
      .insert({ name, email, phone, status: 'in_progress' })
      .select()
      .single()

    if (insertError || !client) {
      throw insertError ?? new Error('Insert returned no row')
    }

    // Written in the same request as the client, so intake opens pre-filled
    // rather than asking again for what was just typed at conversion.
    const details = parsed.data.companyDetails
    if (details) {
      const { error: detailsError } = await supabase
        .from('company_details')
        .insert(companyDetailsInsert(client.id, details))

      if (detailsError) {
        // Undo the client rather than leave a file the caller was told not to
        // create without these. A half-made client with no details is the
        // exact state this whole change exists to prevent, and the caller
        // cannot retry safely while it sits there holding the email.
        await supabase.from('clients').delete().eq('id', client.id)
        console.error('[POST /api/admin/clients] details insert failed:', detailsError.message)
        return NextResponse.json(
          { error: 'Could not save the company details. No client file was created.' },
          { status: 500 },
        )
      }
    }

    // The lead, in the same request as the file it became.
    if (leadId) {
      const at = new Date().toISOString()
      const activity = {
        id: crypto.randomUUID(),
        leadId,
        type: 'stage_change' as const,
        body: CONVERSION_ACTIVITY_BODY,
        // From the session, so a request cannot claim to be somebody else.
        author: staffAuthorName(staff),
        createdAt: at,
      }

      const { error: leadError } = await supabase
        .from('leads')
        .update({
          stage: 'client',
          converted_client_id: client.id,
          // Only restart the clock on an actual move.
          ...(leadStage !== 'client' ? { stage_since: at } : {}),
        })
        .eq('id', leadId)

      // Inserted after the update so the trigger stamps the clock last.
      const { error: activityError } = leadError
        ? { error: null }
        : await supabase.from('lead_activities').insert({
            id: activity.id,
            lead_id: leadId,
            type: activity.type,
            body: activity.body,
            author: activity.author,
            created_at: activity.createdAt,
          })

      if (leadError) {
        // Same reasoning as the details above: a client file whose lead was
        // never linked is the half-made state this request exists to rule
        // out. company_details goes with the client (ON DELETE CASCADE).
        await supabase.from('clients').delete().eq('id', client.id)
        console.error('[POST /api/admin/clients] lead link failed:', leadError.message)
        return NextResponse.json(
          { error: 'Could not update the lead. No client file was created.' },
          { status: 500 },
        )
      }
      if (activityError) {
        // The lead is converted and linked; only its timeline entry is
        // missing. Not worth undoing a conversion over.
        console.error('[POST /api/admin/clients] conversion activity failed:', activityError.message)
        return NextResponse.json({ ...client, leadActivity: null, leadLinked: true }, { status: 201 })
      }

      return NextResponse.json({ ...client, leadActivity: activity, leadLinked: true }, { status: 201 })
    }

    return NextResponse.json(client, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : JSON.stringify(err)
    console.error('[POST /api/admin/clients]', message, err)
    return NextResponse.json({ error: 'Failed to create client', detail: message }, { status: 500 })
  }
}
