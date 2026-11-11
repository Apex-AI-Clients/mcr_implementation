import { it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { parseActivityStatementCsv } from '@/lib/analysis/parseActivityStatement'
import { computeLateLodgement, reanalyseStoredRows } from '@/lib/analysis/computeLateLodgement'
import { LATE_LODGEMENT_SCOPE, storedLateLodgements } from '@/lib/analysis/config'
import { analyseAndStoreLodgement, findActivityStatementCsv } from '@/lib/analysis/lodgementStore'
import { STALE_RULE_CHANGED } from '@/lib/sbr/staleness'
import { out } from './figures'

/**
 * `npm run figures:relodge` — every client's lodgement analysis under the
 * late-lodgement rule now in config.ts (the RBA ICA rule, 12 Nov 2026),
 * against the rule before it (originals only).
 *
 * READ-ONLY by default: per client, late lodgements, cumulative days late and
 * the DPN gross (> 90 days) before → after, and whether its saved SBR
 * prediction used other late-lodgement figures (and so becomes stale).
 *
 * LODGEMENT_RERUN_APPLY=yes (with TZ=UTC: stored dates are ISO strings, the
 * server is UTC) marks each such saved prediction STALE_RULE_CHANGED — unless
 * it already carries a reason — and then re-runs every client's analysis
 * (figures only; the AI summary is written again when staff open the page).
 *
 * Prints aliases (c01, c02, … by client id, as figures:proof) and figures only.
 */
it('re-runs every lodgement analysis under the current late-lodgement rule', async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env')
  const apply = process.env.LODGEMENT_RERUN_APPLY === 'yes'
  if (apply && [0, 6].some((m) => new Date(2026, m, 1).getTimezoneOffset() !== 0)) {
    throw new Error('Re-runs store dates as the server does: run with TZ=UTC (TZ=UTC LODGEMENT_RERUN_APPLY=yes npm run figures:relodge).')
  }
  const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
  const { data: clients, error } = await supabase.from('clients').select('id').order('id')
  if (error) throw new Error(`Reading clients failed: ${error.code}`)

  out(`rule now: ${LATE_LODGEMENT_SCOPE}; before: originals_only; mode: ${apply ? 'APPLY' : 'read-only'}`)
  out('alias | late lodgements before → after | days before → after | DPN gross >90 before → after | saved prediction')
  let changed = 0
  let stale = 0
  for (const [i, { id }] of (clients ?? []).entries()) {
    const alias = `c${String(i + 1).padStart(2, '0')}`
    const { data: stored } = await supabase
      .from('lodgement_analyses')
      .select('rows, number_of_late_lodgements, cumulative_days_late')
      .eq('client_id', id)
      .order('analysed_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const file = await findActivityStatementCsv(supabase as never, id).catch(() => null)
    if (!file) {
      out(`${alias} | no activity statement`)
      continue
    }
    // Before: what the report and the prediction showed under originals only.
    const beforeLate = stored
      ? storedLateLodgements(stored.rows, { numberOfLateLodgements: stored.number_of_late_lodgements, cumulativeDaysLate: stored.cumulative_days_late }, 'originals_only')
      : null
    const beforeDpn = stored ? (reanalyseStoredRows(stored.rows, 'originals_only')?.dpnRisk.totalGrossLate ?? null) : null
    const after = computeLateLodgement(parseActivityStatementCsv(file.text))
    const a = after.summary
    const moved = !beforeLate || beforeLate.numberOfLateLodgements !== a.numberOfLateLodgements || beforeLate.cumulativeDaysLate !== a.cumulativeDaysLate
    if (moved) changed++

    const { data: saved } = await supabase
      .from('sbr_outcome_predictions')
      .select('id, predicted_outcome_percent, input_features, stale_reason')
      .eq('client_id', id)
      .maybeSingle()
    let note = 'none'
    if (saved) {
      const f = (saved.input_features ?? {}) as Record<string, unknown>
      const usedOther = f.numberOfLateLodgements !== a.numberOfLateLodgements || f.cumulativeDaysLate !== a.cumulativeDaysLate
      if (!usedOther) note = `${saved.predicted_outcome_percent}%, current (used ${f.numberOfLateLodgements} / ${f.cumulativeDaysLate})`
      else {
        stale++
        note = `${saved.predicted_outcome_percent}% used ${f.numberOfLateLodgements} / ${f.cumulativeDaysLate}: STALE`
        if (saved.stale_reason) note += ` (keeps "${saved.stale_reason}")`
        else if (apply) {
          const { error: markError } = await supabase.from('sbr_outcome_predictions').update({ stale_reason: STALE_RULE_CHANGED }).eq('id', saved.id)
          note += markError ? ` — NOT marked (${markError.code})` : ` — marked "${STALE_RULE_CHANGED}"`
          if (markError) {
            out(`${alias} | ${note} — analysis left as it was`)
            continue
          }
        } else note += ` (would be marked "${STALE_RULE_CHANGED}")`
      }
    }
    out(
      `${alias} | ${beforeLate?.numberOfLateLodgements ?? '-'} → ${a.numberOfLateLodgements} | ${beforeLate?.cumulativeDaysLate ?? '-'} → ${a.cumulativeDaysLate} | ${beforeDpn ?? '-'} → ${after.dpnRisk.totalGrossLate} | ${note}`,
    )
    if (apply) {
      const outcome = await analyseAndStoreLodgement(supabase as never, id, file, { aiSummary: false })
      out(`  re-run: ${outcome.ok ? `stored (${outcome.result.unparsedDateRows} unread, ${outcome.result.summary.numberOfLateLodgements} late, ${outcome.result.summary.cumulativeDaysLate} days)` : `failed: ${outcome.error}`}`)
    }
  }
  out('')
  out(`${clients?.length ?? 0} clients; late-lodgement figures change for ${changed}; ${stale} saved prediction(s) used other figures.`)
}, 900_000)
