import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServerClient, getSupabaseAuthClient } from '@/lib/supabase/server'
import { sendInviteEmail } from '@/lib/email/resend'
import { z } from 'zod'

interface Params {
  params: Promise<{ id: string }>
}

const AttachmentSchema = z.object({
  filename: z.string(),
  content: z.string(),
})

const ReinviteSchema = z.object({
  message: z.string().optional(),
  attachments: z.array(AttachmentSchema).optional(),
})

async function requireAdmin() {
  const authClient = await getSupabaseAuthClient()
  const {
    data: { user },
  } = await authClient.auth.getUser()
  if (!user) return null
  if (user.app_metadata?.role === 'client') return null
  return user
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const admin = await requireAdmin()
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const parsed = ReinviteSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }
    const { message, attachments } = parsed.data

    const appUrl = process.env.NEXT_PUBLIC_APP_URL
    if (!appUrl) {
      return NextResponse.json(
        { error: 'Server misconfiguration: NEXT_PUBLIC_APP_URL is not set.' },
        { status: 500 },
      )
    }

    const supabase = getSupabaseServerClient()

    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('id, name, email, auth_user_id')
      .eq('id', id)
      .maybeSingle()

    if (clientError || !client) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 })
    }

    const redirectTo = `${appUrl}/portal/set-password`

    // If the client already has an auth user, send a password recovery link
    // (works whether or not they previously accepted the invite). Otherwise
    // generate a fresh invite link, which creates the auth user.
    let inviteLink: string | undefined
    let authUserId = client.auth_user_id

    if (authUserId) {
      const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
        type: 'recovery',
        email: client.email,
        options: { redirectTo },
      })
      if (linkError || !linkData?.properties?.action_link) {
        console.error('[POST /reinvite] recovery generateLink', linkError)
        return NextResponse.json(
          { error: linkError?.message ?? 'Failed to generate recovery link' },
          { status: 500 },
        )
      }
      inviteLink = linkData.properties.action_link
    } else {
      const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
        type: 'invite',
        email: client.email,
        options: { redirectTo, data: { role: 'client', name: client.name } },
      })
      if (linkError || !linkData?.user || !linkData.properties?.action_link) {
        console.error('[POST /reinvite] invite generateLink', linkError)
        return NextResponse.json(
          { error: linkError?.message ?? 'Failed to generate invite link' },
          { status: 500 },
        )
      }
      authUserId = linkData.user.id
      inviteLink = linkData.properties.action_link

      await supabase.auth.admin.updateUserById(authUserId, {
        app_metadata: { role: 'client' },
      })
      await supabase
        .from('clients')
        .update({ auth_user_id: authUserId })
        .eq('id', client.id)
    }

    await sendInviteEmail({
      to: client.email,
      clientName: client.name,
      inviteLink,
      customMessage: message,
      attachments: attachments?.map((a) => ({
        filename: a.filename,
        content: Buffer.from(a.content, 'base64'),
      })),
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    const detail = err instanceof Error ? err.message : JSON.stringify(err)
    console.error('[POST /api/admin/clients/[id]/reinvite]', detail, err)
    return NextResponse.json(
      { error: 'Failed to resend invite', detail },
      { status: 500 },
    )
  }
}
