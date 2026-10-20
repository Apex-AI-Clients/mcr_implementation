import type { getSupabaseServerClient } from '@/lib/supabase/server'
import { generateFinancialsComparisonSummary } from '@/lib/ai/financialsComparisonSummary'
import type { FinancialsComparison } from './types'

/**
 * Server-only. The AI summary of a client's stored comparison, written now if
 * it has none — when staff open the comparison page after an automatic run,
 * which stores the figures only. Built from the stored comparison; no PDF is
 * read or sent again.
 */

type ServerClient = ReturnType<typeof getSupabaseServerClient>

export type ComparisonSummaryOutcome =
  | { kind: 'generated'; text: string; generatedAt: string }
  /** No comparison yet, or it is out of date (a file changed): nothing to summarise. */
  | { kind: 'none' }
  | { kind: 'failed' }

export async function ensureComparisonSummary(
  supabase: ServerClient,
  clientId: string,
): Promise<ComparisonSummaryOutcome> {
  const { data: row } = await supabase
    .from('financial_comparisons')
    .select('id, computed, ai_summary, ai_summary_generated_at, stale_since')
    .eq('client_id', clientId)
    .maybeSingle()
  if (!row || row.stale_since) return { kind: 'none' }
  if (row.ai_summary && row.ai_summary_generated_at) {
    return { kind: 'generated', text: row.ai_summary, generatedAt: row.ai_summary_generated_at }
  }

  try {
    const summary = await generateFinancialsComparisonSummary({
      comparison: row.computed as unknown as FinancialsComparison,
    })
    const now = new Date().toISOString()
    const { error } = await supabase
      .from('financial_comparisons')
      .update({ ai_summary: summary.text, ai_summary_generated_at: now, ai_summary_model: summary.model })
      .eq('id', row.id)
    if (error) console.error('[financials-comparison] storing the summary failed', error.code)
    return { kind: 'generated', text: summary.text, generatedAt: now }
  } catch (err) {
    console.error('[financials-comparison] AI summary failed', err instanceof Error ? err.message : 'unknown')
    return { kind: 'failed' }
  }
}
