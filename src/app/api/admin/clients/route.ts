import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServerClient, getSupabaseAuthClient } from '@/lib/supabase/server'
import { z } from 'zod'

/**
 * Step 2 of the intake, optionally supplied at creation.
 *
 * Every field is optional here because this endpoint serves two callers: the
 * intake wizard, which creates a bare client and fills these in later, and
 * lead conversion, which will not let anyone through without them. Which
 * fields are required is a decision about the conversion form, not about
 * what a client row is allowed to look like — see conversionForm.ts.
 */
const CompanyDetailsSchema = z.object({
  companyName: z.string().max(200).optional(),
  acnNumber: z.string().max(40).optional(),
  abnNumber: z.string().max(40).optional(),
  trustName: z.string().max(200).optional(),
  phoneNumber: z.string().max(40).optional(),
  emailAddress: z.string().max(200).optional(),
})

const CreateClientSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email(),
  companyDetails: CompanyDetailsSchema.optional(),
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
    const supabase = getSupabaseServerClient()

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
      .insert({ name, email, status: 'in_progress' })
      .select()
      .single()

    if (insertError || !client) {
      throw insertError ?? new Error('Insert returned no row')
    }

    // Written in the same request as the client, so intake opens pre-filled
    // rather than asking again for what was just typed at conversion.
    const details = parsed.data.companyDetails
    if (details) {
      const { error: detailsError } = await supabase.from('company_details').insert({
        client_id: client.id,
        company_name: details.companyName ?? null,
        acn_number: details.acnNumber ?? null,
        abn_number: details.abnNumber ?? null,
        trust_name: details.trustName ?? null,
        phone_number: details.phoneNumber ?? null,
        email_address: details.emailAddress ?? null,
      })

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

    return NextResponse.json(client, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : JSON.stringify(err)
    console.error('[POST /api/admin/clients]', message, err)
    return NextResponse.json({ error: 'Failed to create client', detail: message }, { status: 500 })
  }
}
