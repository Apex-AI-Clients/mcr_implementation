import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import type { LearnedPattern } from './learned'

/**
 * Learned patterns (migration 0057), server only (service role). Wording only:
 * no amount, date, client or file is ever stored.
 */

type Db = SupabaseClient<Database>

/** Every pattern staff have not switched off. An unreadable table gives none (the known rules still apply). */
export async function loadPatterns(db: Db): Promise<LearnedPattern[]> {
  const { data, error } = await db.from('ica_learned_patterns').select('wording, printed, counts, explanation').is('disabled_at', null)
  if (error || !data) return []
  return data
    .filter((p) => p.printed === 'with_balance' || p.printed === 'without_balance')
    .map((p) => ({ wording: p.wording, printed: p.printed as LearnedPattern['printed'], count: p.counts, explanation: p.explanation }))
}

/**
 * Keeps patterns from an accepted (balance-verified) proposal. A wording
 * already learned is left as it is: the first verified reading stands, and a
 * contradicting one is reported, never overwritten.
 */
export async function savePatterns(
  db: Db,
  patterns: readonly LearnedPattern[],
  source: { model?: string; generationId?: string },
): Promise<{ saved: number; conflicts: string[] }> {
  if (patterns.length === 0) return { saved: 0, conflicts: [] }
  const { data: existing } = await db.from('ica_learned_patterns').select('wording, printed, counts')
  const known = new Map((existing ?? []).map((p) => [`${p.printed}|${p.wording}`, p.counts]))
  const conflicts: string[] = []
  const fresh = patterns.filter((p) => {
    const was = known.get(`${p.printed}|${p.wording}`)
    if (was === undefined) return true
    if (was !== p.count) conflicts.push(p.wording)
    return false
  })
  if (fresh.length === 0) return { saved: 0, conflicts }
  const { error } = await db.from('ica_learned_patterns').insert(
    fresh.map((p) => ({
      wording: p.wording,
      printed: p.printed,
      counts: p.count,
      explanation: p.explanation.slice(0, 2000),
      model: source.model ?? null,
      generation_id: source.generationId ?? null,
    })),
  )
  if (error) throw new Error(`Learned patterns not saved: ${error.message}`)
  return { saved: fresh.length, conflicts }
}
