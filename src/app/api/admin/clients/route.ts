import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServerClient, getSupabaseAuthClient } from '@/lib/supabase/server'
import { generateMagicToken, tokenExpiresAt, buildPortalUrl } from '@/lib/tokens'
import { sendMagicLinkEmail } from '@/lib/email/resend'
import { z } from 'zod'

const CreateClientSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email(),
})

async function requireAdmin() {
  const authClient = await getSupabaseAuthClient()
  const { data: { user }, error } = await authClient.auth.getUser()
  if (error) console.error('[requireAdmin] auth error:', error.message)
  if (!user) return null
  return user
}

export async function GET() {
  try {
    const admin = await requireAdmin()
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const supabase = await getSupabaseServerClient()
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
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      )
    }

    const { name, email } = parsed.data
    const supabase = await getSupabaseServerClient()

    // Check duplicate — use maybeSingle() so 0 rows returns null, not an error
    const { data: existing } = await supabase
      .from('clients')
      .select('id')
      .eq('email', email)
      .maybeSingle()

    if (existing) {
      return NextResponse.json({ error: 'A client with this email already exists' }, { status: 409 })
    }

    const token = generateMagicToken()
    const expiresAt = tokenExpiresAt()

    const { data: client, error } = await supabase
      .from('clients')
      .insert({
        name,
        email,
        status: 'invited',
        magic_link_token: token,
        link_expires_at: expiresAt.toISOString(),
      })
      .select()
      .single()

    if (error || !client) throw error

    // Send email — non-blocking: log failure but don't fail the request
    const portalUrl = buildPortalUrl(
      process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
      token,
    )
    sendMagicLinkEmail({ to: email, clientName: name, portalUrl, expiresAt }).catch((err) =>
      console.error('[sendMagicLinkEmail]', err),
    )

    return NextResponse.json(client, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : JSON.stringify(err)
    console.error('[POST /api/admin/clients]', message, err)
    return NextResponse.json({ error: 'Failed to create client', detail: message }, { status: 500 })
  }
}
