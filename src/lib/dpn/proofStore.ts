import type { getSupabaseServerClient } from '@/lib/supabase/server'
import { DOCUMENT_CATEGORIES } from '@/lib/constants'
import { readDirectors } from '@/lib/clients/companyDetails'
import { sendDeveloperAlert } from '@/lib/email/resend'
import type { Json } from '@/types/database'
import { loadNoticeAccount } from './noticeAccount'
import type { NoticeProof } from './proof'
import { buildDpnPanel, sydneyToday } from './view'

type ServerClient = ReturnType<typeof getSupabaseServerClient>

/**
 * Server-only. The client's notices proven again (proof.ts) and the result
 * stored (migration 0059), alerting the developer once when a notice becomes
 * unverified: a row in ica_alerts (document_kind 'dpn') and an email with the
 * client id, document id and the periods concerned (dates and counts only; no
 * amount, name, reference or address). Run after a notice is read and after an
 * ATO account is checked (autoRun.ts). Never throws.
 */
export async function proveAndStoreNotices(supabase: ServerClient, clientId: string): Promise<{ checked: number; unverified: number }> {
  try {
    const [{ data: docs }, { data: noticeRows }, { data: company }, account] = await Promise.all([
      supabase.from('documents').select('id, original_filename').eq('client_id', clientId).eq('doc_category', DOCUMENT_CATEGORIES.DIRECTOR_PENALTY_NOTICES),
      supabase.from('director_penalty_notices').select('*').eq('client_id', clientId),
      supabase.from('company_details').select('acn_number, directors').eq('client_id', clientId).maybeSingle(),
      loadNoticeAccount(supabase, clientId).catch(() => null),
    ])
    if (!docs?.length || !noticeRows?.length) return { checked: 0, unverified: 0 }
    const panel = buildDpnPanel({
      documents: docs.map((d) => ({ id: d.id, originalFilename: d.original_filename })),
      noticeRows,
      client: { no_dpn_confirmed_at: null, no_dpn_confirmed_by: null, no_dpn_cleared_note: null },
      file: { acn: company?.acn_number ?? null, directors: readDirectors(company?.directors) },
      todayIso: sydneyToday(),
      account,
    })
    const stored = new Map(noticeRows.map((r) => [r.document_id, r]))
    let unverified = 0
    for (const view of panel.notices) {
      const proof = view.proof
      const row = stored.get(view.documentId)
      if (!proof || !row) continue
      if (proof.status === 'unverified') unverified++
      const was = (row as { proof_status?: string | null }).proof_status ?? null
      const { error } = await supabase
        .from('director_penalty_notices')
        .update({ proof_status: proof.status, proof_check: checkOf(proof) as unknown as Json, proof_checked_at: new Date().toISOString() })
        .eq('id', row.id)
      if (error) return { checked: 0, unverified: 0 } // Before migration 0059: nothing to store.
      if (proof.status === 'unverified' && was !== 'unverified') await alert(supabase, clientId, view.documentId, proof)
    }
    return { checked: panel.notices.filter((v) => v.proof).length, unverified }
  } catch (err) {
    console.error('[dpn-proof] failed', err instanceof Error ? err.message : 'unknown')
    return { checked: 0, unverified: 0 }
  }
}

/** What is stored: periods and counts, no amounts. */
function checkOf(p: NoticeProof) {
  return {
    addsUp: p.addsUp,
    rowsNotAddingUp: p.rowsNotAddingUp.map((r) => ({ from: r.periodFrom, to: r.periodTo })),
    totalsMatchRows: p.totalsMatchRows,
    fieldsMissing: p.fieldsMissing,
    account: p.account
      ? {
          periods: p.account.periods,
          matched: p.account.matched,
          outside: p.account.outside.map((o) => ({ from: o.periodFrom, to: o.periodTo })),
          mismatches: p.account.mismatches.map((m) => ({ from: m.periodFrom, to: m.periodTo })),
        }
      : null,
    badges: p.badges,
  }
}

async function alert(supabase: ServerClient, clientId: string, documentId: string, p: NoticeProof): Promise<void> {
  const periods = [
    ...p.rowsNotAddingUp.map((r) => ({ from: r.periodFrom, to: r.periodTo, rows: 1, reason: 'column_3_is_not_4_plus_5' })),
    ...(p.account?.mismatches ?? []).map((m) => ({ from: m.periodFrom, to: m.periodTo, rows: m.accountRows.length, reason: 'column_2_differs_from_ato_account' })),
  ]
  const reasons = [
    !p.addsUp && 'The notice does not add up as read',
    p.fieldsMissing.length > 0 && `Not read: ${p.fieldsMissing.join(', ')}`,
    (p.account?.mismatches.length ?? 0) > 0 && `${p.account!.mismatches.length} period(s) differ from the verified ATO account`,
  ].filter((r): r is string => !!r)
  const { data: row } = await supabase
    .from('ica_alerts')
    .insert({ client_id: clientId, document_id: documentId, document_kind: 'dpn', account_kind: null, windows: periods as unknown as Json, hold_reasons: reasons })
    .select('id')
    .single()
  const app = process.env.NEXT_PUBLIC_APP_URL ?? ''
  const text = [
    'A director penalty notice is not proven. Its totals are held back ("Being prepared").',
    '',
    `Client id: ${clientId}`,
    `Document id: ${documentId}`,
    `Why: ${reasons.join('; ') || 'not proven'}`,
    ...periods.map((x) => `Period ${x.from} to ${x.to}: ${x.reason.replace(/_/g, ' ')}`),
    '',
    `${app}/clients/${clientId}/director-penalty-notices`,
  ].join('\n')
  try {
    await sendDeveloperAlert({ subject: `Director penalty notice not proven — client ${clientId.slice(0, 8)}`, text })
    if (row) await supabase.from('ica_alerts').update({ emailed_at: new Date().toISOString() }).eq('id', row.id)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown'
    if (row) await supabase.from('ica_alerts').update({ email_error: message.slice(0, 500) }).eq('id', row.id)
  }
}
