import type { getSupabaseServerClient } from '@/lib/supabase/server'
import { sendDeveloperAlert } from '@/lib/email/resend'
import type { Json } from '@/types/database'

type ServerClient = ReturnType<typeof getSupabaseServerClient>

/**
 * Server-only. A technical problem for the developer, never for staff screens (Gabby, 24 Nov 2026):
 * kept in developer_alerts (migration 0066) and emailed to ALERT_EMAIL, once per `key` while it is
 * open. `lines` and `details` carry ids and counts only: never a name, an answer, a figure or a
 * file name. Never throws; before 0066 is applied, the email is still sent (no log, so no dedupe
 * across requests: the caller should only raise it where it happens once).
 */
export interface DeveloperAlert {
  kind: string
  key: string
  subject: string
  lines: string[]
  details?: Record<string, string | number | boolean | null>
}

export async function raiseDeveloperAlert(supabase: ServerClient, alert: DeveloperAlert): Promise<'sent' | 'already_open' | 'failed'> {
  try {
    const { data: open, error: readError } = await supabase.from('developer_alerts').select('id').eq('key', alert.key).is('resolved_at', null).limit(1)
    if (!readError && open?.length) return 'already_open'
    let rowId: string | null = null
    if (!readError) {
      const { data: row, error } = await supabase
        .from('developer_alerts')
        .insert({ kind: alert.kind, key: alert.key, details: (alert.details ?? {}) as Json })
        .select('id')
        .single()
      // Another request raised it first (the open-key index): nothing more to do.
      if (error?.code === '23505') return 'already_open'
      rowId = row?.id ?? null
    }
    try {
      await sendDeveloperAlert({ subject: alert.subject, text: alert.lines.join('\n') })
      if (rowId) await supabase.from('developer_alerts').update({ emailed_at: new Date().toISOString() }).eq('id', rowId)
      return 'sent'
    } catch (err) {
      if (rowId) await supabase.from('developer_alerts').update({ email_error: (err instanceof Error ? err.message : 'unknown').slice(0, 500) }).eq('id', rowId)
      return 'failed'
    }
  } catch (err) {
    console.error('[developer-alert] failed', err instanceof Error ? err.name : 'unknown')
    return 'failed'
  }
}
