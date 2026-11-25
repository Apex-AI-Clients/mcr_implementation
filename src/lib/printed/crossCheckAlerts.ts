import type { getSupabaseServerClient } from '@/lib/supabase/server'
import { sendDeveloperAlert } from '@/lib/email/resend'
import type { PrintedComparison } from './compare'
import { comparisonProof } from './proof'

/**
 * Server-only. A failed cross-check (crossChecks.ts) alerts the developer once per client, period
 * and check: a row in ica_alerts (document_kind 'statement', the reason key in hold_reasons) and an
 * email with ids, the period and the check's name only: no figure, name or file name. The period is
 * shown as printed with a note; nothing waits on this (Gabby, 25 Nov 2026). Never throws.
 */

type ServerClient = ReturnType<typeof getSupabaseServerClient>

const CHECK_WORDS = {
  pl_agrees_bs: 'the profit and loss net profit does not agree with the balance sheet current year earnings',
  carries_forward: 'retained earnings do not carry forward from the previous year',
} as const

export function failedCrossChecks(comparison: PrintedComparison) {
  return comparisonProof(comparison).flatMap((year) =>
    year.crossChecks
      .filter((c) => c.status === 'failed')
      .map((c) => ({
        key: `cross_check:${c.check}:${year.column}`,
        check: c.check,
        column: year.column,
        // The file the period's balance sheet figure comes from (both checks read it).
        documentId: c.sources?.balanceSheet ?? year.documentIds[0] ?? null,
        documentIds: [...new Set([c.sources?.profitAndLoss, c.sources?.balanceSheet, ...year.documentIds].filter((d): d is string => !!d))],
        differentSources: !!c.sources && c.sources.profitAndLoss !== c.sources.balanceSheet,
      })),
  )
}

export async function alertFailedCrossChecks(supabase: ServerClient, clientId: string, comparison: PrintedComparison): Promise<number> {
  let sent = 0
  try {
    for (const f of failedCrossChecks(comparison)) {
      const { data: open, error: readError } = await supabase
        .from('ica_alerts')
        .select('id')
        .eq('client_id', clientId)
        .eq('document_kind', 'statement')
        .contains('hold_reasons', [f.key])
        .is('resolved_at', null)
        .limit(1)
      if (readError || open?.length) continue
      const { data: row, error } = await supabase
        .from('ica_alerts')
        .insert({ client_id: clientId, document_id: f.documentId, document_kind: 'statement', windows: [{ from: f.column, to: f.column, rows: 1, reason: f.check }] as never, hold_reasons: [f.key] })
        .select('id')
        .single()
      if (error) return sent // Before migration 0059: no alert kind to store.
      const app = process.env.NEXT_PUBLIC_APP_URL ?? ''
      const text = [
        `A financial statements cross-check failed: ${CHECK_WORDS[f.check]}. The period is shown as printed with a note; the prediction is not blocked.`,
        '',
        `Client id: ${clientId}`,
        `Period: ${f.column}`,
        `Document ids: ${f.documentIds.join(', ')}`,
        ...(f.differentSources ? ['The profit and loss and the balance sheet come from different files.'] : []),
        '',
        `${app}/clients/${clientId}/financials-comparison`,
      ].join('\n')
      try {
        await sendDeveloperAlert({ subject: `Statements cross-check failed — client ${clientId.slice(0, 8)}, ${f.column}`, text })
        if (row) await supabase.from('ica_alerts').update({ emailed_at: new Date().toISOString() }).eq('id', row.id)
        sent++
      } catch (err) {
        if (row) await supabase.from('ica_alerts').update({ email_error: (err instanceof Error ? err.message : 'unknown').slice(0, 500) }).eq('id', row.id)
      }
    }
  } catch (err) {
    console.error('[cross-check-alerts] failed', err instanceof Error ? err.message : 'unknown')
  }
  return sent
}
