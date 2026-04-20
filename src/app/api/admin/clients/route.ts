import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServerClient, getSupabaseAuthClient } from '@/lib/supabase/server'
import { z } from 'zod'

const CreateClientSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email(),
})

async function requireAdmin() {
  const authClient = await getSupabaseAuthClient()
  const {
    data: { user },
    error,
  } = await authClient.auth.getUser()
  if (error) console.error('[requireAdmin] auth error:', error.message)
  if (!user) return null
  // Clients authenticate against the same Supabase project; make sure this session
  // is *not* a client session leaking into admin endpoints.
  if (user.app_metadata?.role === 'client') return null
  return user
}

export async function GET() {
  try {
    const admin = await requireAdmin()
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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

export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin()
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const parsed = CreateClientSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    const { name, email } = parsed.data
    const supabase = getSupabaseServerClient()

    const { data: existing } = await supabase
      .from('clients')
      .select('id')
      .eq('email', email)
      .maybeSingle()
    if (existing) {
      return NextResponse.json(
        { error: 'A client with this email already exists' },
        { status: 409 },
      )
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL
    if (!appUrl) {
      return NextResponse.json(
        { error: 'Server misconfiguration: NEXT_PUBLIC_APP_URL is not set.' },
        { status: 500 },
      )
    }

    // Supabase Auth sends the invite email. After the user clicks the link,
    // Supabase redirects them to this URL with hash-fragment tokens (#access_token=...).
    // The set-password page (client-side) picks up the tokens and establishes the session.
    const redirectTo = `${appUrl}/portal/set-password`

    const { data: inviteData, error: inviteError } =
      await supabase.auth.admin.inviteUserByEmail(email, {
        redirectTo,
        data: { role: 'client', name },
      })

    if (inviteError || !inviteData?.user) {
      console.error('[POST /api/admin/clients] inviteUserByEmail', inviteError)
      return NextResponse.json(
        { error: inviteError?.message ?? 'Failed to send invite' },
        { status: 500 },
      )
    }

    const authUserId = inviteData.user.id

    // Promote the freshly-created auth user to the `client` role via app_metadata
    // (not user-modifiable, used by proxy.ts to gate routes).
    const { error: metaError } = await supabase.auth.admin.updateUserById(authUserId, {
      app_metadata: { role: 'client' },
    })
    if (metaError) console.error('[POST /api/admin/clients] updateUserById', metaError)

    const { data: client, error: insertError } = await supabase
      .from('clients')
      .insert({
        name,
        email,
        status: 'invited',
        auth_user_id: authUserId,
      })
      .select()
      .single()

    if (insertError || !client) {
      // Best-effort rollback: delete the orphaned auth user so the admin can retry.
      await supabase.auth.admin.deleteUser(authUserId).catch(() => undefined)
      throw insertError ?? new Error('Insert returned no row')
    }

    return NextResponse.json(client, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : JSON.stringify(err)
    console.error('[POST /api/admin/clients]', message, err)
    return NextResponse.json(
      { error: 'Failed to create client', detail: message },
      { status: 500 },
    )
  }
}
