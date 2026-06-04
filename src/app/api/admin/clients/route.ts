import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServerClient, getSupabaseAuthClient } from '@/lib/supabase/server'
import { z } from 'zod'

const CreateClientSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email(),
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

    return NextResponse.json(client, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : JSON.stringify(err)
    console.error('[POST /api/admin/clients]', message, err)
    return NextResponse.json({ error: 'Failed to create client', detail: message }, { status: 500 })
  }
}
