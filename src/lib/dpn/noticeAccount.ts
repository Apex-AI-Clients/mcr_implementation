import type { getSupabaseServerClient } from '@/lib/supabase/server'
import { readStoredRows } from '@/lib/ica/read'
import { reconcile } from '@/lib/ica/reconcile'
import { forcedFrom } from '@/lib/ica/status'
import { noticeAccountFrom, type NoticeAccount } from './proof'

type ServerClient = ReturnType<typeof getSupabaseServerClient>

/**
 * The client's activity statement accounts verified against the ATO's own
 * balance (migration 0058), for checking director penalty notices against
 * (proof.ts): the newest analysed file of each account, read from its stored
 * rows with the readings its check proved. Null when none is verified: the
 * notices are then proven by their own arithmetic only. Server only.
 */
export async function loadNoticeAccount(supabase: ServerClient, clientId: string): Promise<NoticeAccount | null> {
  const { data } = await supabase
    .from('lodgement_analyses')
    .select('statement_label, rows, analysed_at, ica_status, ica_forced')
    .eq('client_id', clientId)
    .order('analysed_at', { ascending: false })
  const newest = new Map<string, NonNullable<typeof data>[number]>()
  for (const row of data ?? []) {
    const key = (row.statement_label ?? '').trim().toLowerCase()
    if (!newest.has(key)) newest.set(key, row)
  }
  const accounts = [...newest.values()]
    .filter((row) => row.ica_status === 'verified')
    .flatMap((row) => {
      const file = readStoredRows(row.rows, { label: row.statement_label })
      if (!file) return []
      const reconciliation = reconcile(file, { forced: forcedFrom(row.ica_forced) })
      return reconciliation.verified ? [{ file, reconciliation }] : []
    })
  return accounts.length ? noticeAccountFrom(accounts) : null
}
