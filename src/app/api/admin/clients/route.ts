import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServerClient, getSupabaseAuthClient } from '@/lib/supabase/server'
import { z } from 'zod'
import { normaliseClientPhone } from '@/lib/clients/phone'
import { CompanyDetailsSchema, companyDetailsInsert } from '@/lib/clients/companyDetails'
import { staffAuthorName } from '@/lib/auth/staff'
import { conversionBody } from '@/lib/leads/clientDeleted'
import { cvlEnabled } from '@/lib/cvl/flag'
import { getCustomStages } from '@/lib/leads/customStages'
import { isCustomStage } from '@/lib/leads/constants'
import type { LeadStage } from '@/types/leads'

/**
 * Step 2 of the intake, optionally supplied at creation.
 *
 * Every field is optional here because this endpoint serves two callers: the
 * intake wizard, which creates a bare client and fills these in later, and
 * lead conversion, which offers them but requires none of them. Which
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
   * The enquiry (lead_submissions row) this client file is being created from
   * (migration 0052). When given, the enquiry is linked to the file and its
   * lead marked converted here, in this request — not in a second one from
   * the browser. A page reload, a closed tab or a dropped connection between
   * two requests used to leave a client file whose lead still said "lead" and
   * still offered to convert.
   *
   * One enquiry makes one file; a lead with two enquiries can make two.
   */
  enquiryId: z.string().uuid().optional(),
  /**
   * Which workspace the new file opens in (migration 0039): an SBR client
   * (the default) or a CVL client, whose case is opened in this request.
   */
  workflow: z.enum(['sbr', 'cvl']).optional(),
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
      // Archived files are in the Archive, not the client list; CVL files
      // are in the CVL workspace.
      .is('archived_at', null)
      .eq('workflow', 'sbr')
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
 * just a stored contact field, and not unique (0052): one person can have a
 * file per enquiry. Staff then complete the intake wizard for the returned
 * client id.
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
    const enquiryId = parsed.data.enquiryId

    // Before anything is created: an enquiry that is not there, or that is
    // already a client file, cannot be converted. Another file for the same
    // email is fine (0052): each enquiry can become its own file.
    let leadId: string | null = null
    let leadStage: string | null = null
    let enquiryReceivedAt: string | null = null
    if (enquiryId) {
      const { data: enquiry, error: enquiryError } = await supabase
        .from('lead_submissions')
        .select('id, lead_id, received_at, converted_client_id')
        .eq('id', enquiryId)
        .maybeSingle()
      if (enquiryError) throw enquiryError
      if (!enquiry) return NextResponse.json({ error: 'Enquiry not found' }, { status: 404 })
      if (enquiry.converted_client_id) {
        return NextResponse.json(
          { error: 'This enquiry already has a client file', clientId: enquiry.converted_client_id },
          { status: 409 },
        )
      }
      enquiryReceivedAt = enquiry.received_at

      const { data: lead, error: leadError } = await supabase
        .from('leads')
        .select('id, stage')
        .eq('id', enquiry.lead_id)
        .maybeSingle()
      if (leadError) throw leadError
      if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
      leadId = lead.id
      leadStage = lead.stage
    }

    const workflow = parsed.data.workflow ?? 'sbr'
    // CVL switched off: there is no CVL client to make.
    if (workflow === 'cvl' && !cvlEnabled()) {
      return NextResponse.json({ error: 'Unknown workflow' }, { status: 400 })
    }
    const { data: client, error: insertError } = await supabase
      .from('clients')
      .insert({ name, email, phone, status: 'in_progress', workflow })
      .select()
      .single()

    if (insertError || !client) {
      throw insertError ?? new Error('Insert returned no row')
    }

    // A CVL file without its case is half-made: undone the same way as the
    // details below.
    if (workflow === 'cvl') {
      const { error: caseError } = await supabase
        .from('cvl_cases')
        .insert({ client_id: client.id, origin: 'lead', created_by: staffAuthorName(staff) })
      if (caseError) {
        await supabase.from('clients').delete().eq('id', client.id)
        console.error('[POST /api/admin/clients] CVL case insert failed:', caseError.message)
        return NextResponse.json(
          { error: 'Could not open the CVL file. No client file was created.' },
          { status: 500 },
        )
      }
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

    // The enquiry and its lead, in the same request as the file they became.
    if (enquiryId && leadId) {
      // Only while still unconverted: two people converting the same enquiry
      // at once get one file, not two. The unique index (0052) backs this up.
      const { data: linked, error: enquiryError } = await supabase
        .from('lead_submissions')
        .update({ converted_client_id: client.id })
        .eq('id', enquiryId)
        .is('converted_client_id', null)
        .select('id')
      if (enquiryError || !linked || linked.length === 0) {
        await supabase.from('clients').delete().eq('id', client.id)
        if (enquiryError) {
          console.error('[POST /api/admin/clients] enquiry link failed:', enquiryError.message)
        }
        const taken = !enquiryError || enquiryError.code === '23505'
        return NextResponse.json(
          {
            error: taken
              ? 'This enquiry was converted a moment ago. No client file was created.'
              : 'Could not update the enquiry. No client file was created.',
          },
          { status: taken ? 409 : 500 },
        )
      }

      const at = new Date().toISOString()
      const activity = {
        id: crypto.randomUUID(),
        leadId,
        type: 'stage_change' as const,
        // With the stage it came from: a deleted client file sets the lead back to it.
        body: conversionBody(
          leadStage as LeadStage | null,
          leadStage && isCustomStage(leadStage) ? await getCustomStages() : [],
          enquiryReceivedAt,
        ),
        // From the session, so a request cannot claim to be somebody else.
        author: staffAuthorName(staff),
        createdAt: at,
      }

      const { error: leadError } = await supabase
        .from('leads')
        .update({
          stage: 'client',
          // The newest file from this lead; each enquiry holds its own.
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
        // out. company_details goes with the client (ON DELETE CASCADE), and
        // the enquiry's link clears with it (ON DELETE SET NULL).
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
