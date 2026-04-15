import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { sendReminderEmail } from '@/lib/email/resend'
import { REQUIRED_CATEGORIES, CATEGORY_META, REMINDER_DAYS } from '@/lib/constants'
import type { DocCategory } from '@/lib/constants'
import { daysSince } from '@/lib/utils'

export async function GET(req: NextRequest) {
  // Verify cron secret
  const auth = req.headers.get('authorization')
  if (!auth || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const supabase = await getSupabaseServerClient()

    const { data: clients, error } = await supabase
      .from('clients')
      .select('id, name, email, magic_link_token, created_at, status')
      .in('status', ['invited', 'in_progress', 'missing_items'])

    if (error) throw error

    let sent = 0
    let skipped = 0

    for (const client of clients ?? []) {
      const age = daysSince(client.created_at)

      if (!REMINDER_DAYS.includes(age)) {
        skipped++
        continue
      }

      // Check if already sent today
      const todayStart = new Date()
      todayStart.setHours(0, 0, 0, 0)

      const { data: existing } = await supabase
        .from('follow_ups')
        .select('id')
        .eq('client_id', client.id)
        .eq('type', 'auto')
        .gte('sent_at', todayStart.toISOString())
        .single()

      if (existing) {
        skipped++
        continue
      }

      // Get missing required categories
      const { data: docs } = await supabase
        .from('documents')
        .select('doc_category')
        .eq('client_id', client.id)
        .neq('status', 'rejected')

      const receivedCategories = new Set(
        (docs ?? []).map((d) => d.doc_category as DocCategory),
      )
      const missingCategories = REQUIRED_CATEGORIES.filter(
        (c) => !receivedCategories.has(c),
      )

      if (missingCategories.length === 0) {
        skipped++
        continue
      }

      const missingLabels = missingCategories.map((c) => CATEGORY_META[c].label)

      await sendReminderEmail({
        to: client.email,
        clientName: client.name,
        portalUrl: `${process.env.NEXT_PUBLIC_APP_URL}/portal/${client.magic_link_token}`,
        missingItems: missingLabels,
      })

      await supabase.from('follow_ups').insert({
        client_id: client.id,
        type: 'auto',
        missing_items: missingLabels,
        email_status: 'sent',
      })

      await supabase
        .from('clients')
        .update({ status: 'missing_items' })
        .eq('id', client.id)
        .neq('status', 'complete')

      sent++
    }

    return NextResponse.json({ ok: true, sent, skipped })
  } catch (err) {
    console.error('[GET /api/cron/send-reminders]', err)
    return NextResponse.json({ error: 'Cron job failed' }, { status: 500 })
  }
}
