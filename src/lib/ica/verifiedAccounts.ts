import type { getSupabaseServerClient } from '@/lib/supabase/server'
import { readStoredRows } from './read'
import { reconcile } from './reconcile'
import { forcedFrom } from './status'
import type { VerifiedAccount } from './balanceAt'

type ServerClient = ReturnType<typeof getSupabaseServerClient>

/**
 * The client's activity statement accounts for "ATO related debt – ICA" (balanceAt.ts): the newest
 * analysed file of each account, read from its stored rows with the readings its check proved.
 * 'held' when any account is not verified against the ATO's own balance (its figures wait, "Being
 * prepared"); 'none' with no activity statement account on file. Server only.
 */
export async function loadVerifiedActivityAccounts(
  supabase: ServerClient,
  clientId: string,
): Promise<{ status: 'none' | 'held' | 'ok'; accounts: VerifiedAccount[] }> {
  const { data } = await supabase
    .from('lodgement_analyses')
    .select('document_id, statement_label, rows, analysed_at, ica_status, ica_forced, documents(original_filename)')
    .eq('client_id', clientId)
    .order('analysed_at', { ascending: false })
  const newest = new Map<string, NonNullable<typeof data>[number]>()
  for (const row of data ?? []) {
    const key = (row.statement_label ?? '').trim().toLowerCase()
    if (!newest.has(key)) newest.set(key, row)
  }
  if (newest.size === 0) return { status: 'none', accounts: [] }
  const accounts: VerifiedAccount[] = []
  for (const row of newest.values()) {
    if (row.ica_status !== 'verified') return { status: 'held', accounts: [] }
    const file = readStoredRows(row.rows, { label: row.statement_label })
    if (!file) return { status: 'held', accounts: [] }
    const reconciliation = reconcile(file, { forced: forcedFrom(row.ica_forced) })
    if (!reconciliation.verified) return { status: 'held', accounts: [] }
    const doc = row.documents as { original_filename: string } | { original_filename: string }[] | null
    const filename = (Array.isArray(doc) ? doc[0] : doc)?.original_filename ?? 'ATO account'
    accounts.push({ label: row.statement_label ?? file.label, documentId: row.document_id, filename, file, reconciliation })
  }
  return { status: 'ok', accounts }
}
