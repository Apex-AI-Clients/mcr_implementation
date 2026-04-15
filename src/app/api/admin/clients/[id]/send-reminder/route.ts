import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServerClient, getSupabaseAuthClient } from '@/lib/supabase/server'
import { sendReminderEmail } from '@/lib/email/resend'
import { REQUIRED_CATEGORIES, CATEGORY_META } from '@/lib/constants'
import type { DocCategory } from '@/lib/constants'

interface Params {
  params: Promise<{ id: string }>
}

async function requireAdmin() {
  const authClient = await getSupabaseAuthClient()
  const { data: { user }, error } = await authClient.auth.getUser()
  if (error) console.error('[requireAdmin] auth error:', error.message)
  if (!user) return null
  return user
}

export async function POST(_req: NextRequest, { params }: Params) {
  try {
    await requireAdmin()
    const { id } = await params
    const supabase = await getSupabaseServerClient()

    const { data: client, error } = await supabase
      .from('clients')
      .select('*')
      .eq('id', id)
      .single()

    if (error || !client) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 })
    }

    const { data: documents } = await supabase
      .from('documents')
      .select('doc_category')
      .eq('client_id', id)
      .neq('status', 'rejected')

    const receivedCategories = new Set(
      (documents ?? []).map((d) => d.doc_category as DocCategory),
    )
    const missingCategories = REQUIRED_CATEGORIES.filter((c) => !receivedCategories.has(c))
    const missingLabels = missingCategories.map((c) => CATEGORY_META[c].label)

    await sendReminderEmail({
      to: client.email,
      clientName: client.name,
      portalUrl: `${process.env.NEXT_PUBLIC_APP_URL}/portal/${client.magic_link_token}`,
      missingItems: missingLabels,
    })

    await supabase.from('follow_ups').insert({
      client_id: id,
      type: 'manual',
      missing_items: missingLabels,
      email_status: 'sent',
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[POST /api/admin/clients/[id]/send-reminder]', err)
    return NextResponse.json({ error: 'Failed to send reminder' }, { status: 500 })
  }
}
