import { createHash } from 'node:crypto'
import type { getSupabaseServerClient } from '@/lib/supabase/server'
import {
  SUMMARY_BLOCK_MESSAGE,
  comparisonSummaryPrompt,
  generateComparisonSummary,
  summaryBlock,
  type SummaryBlock,
} from '@/lib/ai/financialsComparisonSummary'
import { loadPrintedComparison } from '@/lib/printed/store'
import { loadMapping } from '@/lib/printed/mappingStore'

/**
 * Server-only. The comparison summary for a client: the stored one while the
 * confirmed figures it was written from are unchanged, else written now and
 * stored (ai_summaries, migration 0036). Built from the default view of the
 * as-printed comparison (no comparative-only years) and the confirmed mapping;
 * no PDF is read or sent.
 */

type ServerClient = ReturnType<typeof getSupabaseServerClient>

export type ComparisonSummaryOutcome =
  | { kind: 'generated'; text: string; generatedAt: string; model: string }
  | { kind: 'blocked'; reason: SummaryBlock; message: string }
  | { kind: 'failed' }

export async function ensureComparisonSummary(supabase: ServerClient, clientId: string): Promise<ComparisonSummaryOutcome> {
  const [{ comparison, builtAt }, mapping, { data: checked }] = await Promise.all([
    loadPrintedComparison(supabase, clientId),
    loadMapping(supabase, clientId),
    supabase.from('sbr_readiness_reviews').select('fingerprint, reviewed_by, reviewed_at').eq('client_id', clientId).eq('item', 'financials').maybeSingle(),
  ])
  const reason = summaryBlock({
    comparison,
    mapping,
    builtAt,
    checked: checked ? { fingerprint: checked.fingerprint, by: checked.reviewed_by, at: checked.reviewed_at } : null,
  })
  if (reason) return { kind: 'blocked', reason, message: SUMMARY_BLOCK_MESSAGE[reason] }

  const prompt = comparisonSummaryPrompt(comparison, mapping)
  if (!prompt) return { kind: 'blocked', reason: 'no_confirmed_figures', message: SUMMARY_BLOCK_MESSAGE.no_confirmed_figures }
  const fingerprint = createHash('sha256').update(prompt).digest('hex')

  const { data: stored, error: readError } = await supabase
    .from('ai_summaries')
    .select('input_fingerprint, summary, model, generated_at')
    .eq('client_id', clientId)
    .eq('kind', 'financials')
    .maybeSingle()
  // Without the table (0036 not applied) nothing could be kept: write nothing rather than pay on every visit.
  if (readError) {
    console.error('[comparison-summary] reading the stored summary failed', readError.code)
    return { kind: 'failed' }
  }
  if (stored && stored.input_fingerprint === fingerprint) {
    return { kind: 'generated', text: stored.summary, generatedAt: stored.generated_at, model: stored.model }
  }

  try {
    const summary = await generateComparisonSummary(comparison, mapping)
    const now = new Date().toISOString()
    const { error } = await supabase
      .from('ai_summaries')
      .upsert({ client_id: clientId, kind: 'financials', input_fingerprint: fingerprint, summary: summary.text, model: summary.model, generated_at: now })
    if (error) console.error('[comparison-summary] storing the summary failed', error.code)
    return { kind: 'generated', text: summary.text, generatedAt: now, model: summary.model }
  } catch (err) {
    console.error('[comparison-summary] AI summary failed', err instanceof Error ? err.name : 'unknown')
    return { kind: 'failed' }
  }
}
