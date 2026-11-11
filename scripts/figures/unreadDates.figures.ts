import { it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { parse as parseDate, isValid } from 'date-fns'
import { parseActivityStatementCsv, parseAtoDate } from '@/lib/analysis/parseActivityStatement'
import { computeLateLodgement } from '@/lib/analysis/computeLateLodgement'
import { LATE_LODGEMENT_SCOPE, storedLateLodgements, unparsedDateRows } from '@/lib/analysis/config'
import { analyseAndStoreLodgement, findActivityStatementCsv } from '@/lib/analysis/lodgementStore'
import { analyseAndStoreAtoAccount, clientNamesFor } from '@/lib/analysis/atoAccount/store'
import { out } from './figures'

/**
 * `npm run figures:dates` — which clients' ATO account CSVs have dates the
 * parser could not read (a file re-saved in Excel: "20-Oct-26" instead of
 * "20 Oct 2026"), so their late-lodgement figures may read 0.
 *
 * READ-ONLY by default (SELECTs and storage downloads). For each client:
 *   - the stored lodgement analysis: rows saved without a date, and the
 *     late lodgements / days the prediction takes from it now;
 *   - every CSV on file in an ATO account format: rows whose dates the parser
 *     before 11 Nov 2026 could not read, and how many the current one cannot;
 *   - the activity statement analysis with the current code.
 *
 * ATO_DATES_APPLY=yes re-runs, with the current code: the stored lodgement
 * analysis (figures only, no AI summary) of each client whose stored rows
 * lack dates, and the ATO account analysis (ato_account_analyses) of each CSV
 * whose dates the old parser could not read. Only after migration 0048 is
 * applied and the fix is deployed.
 *
 * Prints aliases (c01, c02, … by client id, as figures:proof) and counts only.
 */

/** The parser before 11 Nov 2026: the ATO's own "20 Oct 2026" only. */
function oldParse(raw: string): Date | null {
  const t = raw.trim()
  if (!t) return null
  const d = parseDate(t, 'dd MMM yyyy', new Date())
  return isValid(d) ? d : null
}

it('lists clients whose ATO account CSV dates could not be read', async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env')
  const apply = process.env.ATO_DATES_APPLY === 'yes'
  // Stored rows carry the parser's local-midnight dates as ISO strings; the
  // server runs in UTC. Re-run anywhere else and every stored date moves a day.
  if (apply && [0, 6].some((m) => new Date(2026, m, 1).getTimezoneOffset() !== 0)) {
    throw new Error('Re-runs store dates as the server does: run with TZ=UTC (e.g. TZ=UTC ATO_DATES_APPLY=yes npm run figures:dates).')
  }
  const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })

  const { data: clients, error } = await supabase.from('clients').select('id').order('id')
  if (error) throw new Error(`Reading clients failed: ${error.code}`)

  out(`late-lodgement setting: ${LATE_LODGEMENT_SCOPE}; mode: ${apply ? 'APPLY (re-runs affected analyses)' : 'read-only'}`)
  out('alias | stored analysis: rows without dates / rows, late, days | CSVs on file: rows old parser cannot read → current parser | activity statement now: unread, late, days')
  let affected = 0
  let csvAffected = 0
  for (const [i, { id }] of (clients ?? []).entries()) {
    const alias = `c${String(i + 1).padStart(2, '0')}`

    const { data: stored } = await supabase
      .from('lodgement_analyses')
      .select('id, rows, number_of_late_lodgements, cumulative_days_late')
      .eq('client_id', id)
      .order('analysed_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const storedRows = Array.isArray(stored?.rows) ? stored.rows : []
    const storedUnread = stored ? unparsedDateRows(stored.rows) : null
    const storedLate = stored
      ? storedLateLodgements(stored.rows, { numberOfLateLodgements: stored.number_of_late_lodgements, cumulativeDaysLate: stored.cumulative_days_late })
      : null

    // Every CSV on file that is in an ATO account format (activity statement, income tax, super guarantee).
    const { data: docs } = await supabase.from('documents').select('id, file_path, original_filename, file_type').eq('client_id', id)
    const csvNotes: string[] = []
    const rerunCsvs: { id: string; text: string }[] = []
    for (const doc of docs ?? []) {
      const isCsv = doc.file_type === 'text/csv' || doc.original_filename.toLowerCase().endsWith('.csv')
      if (!isCsv || !doc.file_path) continue
      const { data: blob } = await supabase.storage.from('documents').download(doc.file_path)
      if (!blob) continue
      const text = await blob.text()
      let rows
      try {
        rows = parseActivityStatementCsv(text).rows
      } catch {
        continue // not an ATO account export
      }
      const before = rows.filter((r) => !oldParse(r.rawProcessed) || !oldParse(r.rawEffective)).length
      const now = rows.filter((r) => !parseAtoDate(r.rawProcessed) || !parseAtoDate(r.rawEffective)).length
      if (before > 0 || now > 0) csvNotes.push(`${before}/${rows.length} → ${now}`)
      if (before > 0) rerunCsvs.push({ id: doc.id, text })
    }
    if (csvNotes.length > 0) csvAffected += 1

    const file = await findActivityStatementCsv(supabase as never, id).catch(() => null)
    const fresh = file ? computeLateLodgement(parseActivityStatementCsv(file.text)) : null

    const isAffected = (storedUnread ?? 0) > 0 || csvNotes.length > 0
    if (!isAffected) continue
    affected += 1
    const s = stored ? `${storedUnread}/${storedRows.length}, ${storedLate?.numberOfLateLodgements} late, ${storedLate?.cumulativeDaysLate} days` : 'none'
    const f = fresh ? `${fresh.unparsedDateRows} unread, ${fresh.summary.numberOfLateLodgements} late, ${fresh.summary.cumulativeDaysLate} days` : 'no activity statement'
    out(`${alias} | ${s} | ${csvNotes.join('; ') || 'all readable'} | ${f}`)

    if (apply && file && (storedUnread ?? 0) > 0) {
      const outcome = await analyseAndStoreLodgement(supabase as never, id, file, { aiSummary: false })
      out(`  re-run lodgement analysis: ${outcome.ok ? `stored (${outcome.result.unparsedDateRows} unread, ${outcome.result.summary.numberOfLateLodgements} late, ${outcome.result.summary.cumulativeDaysLate} days)` : `failed: ${outcome.error}`}`)
    }
    if (apply && rerunCsvs.length > 0) {
      const names = await clientNamesFor(supabase as never, id)
      for (const csv of rerunCsvs) {
        const outcome = await analyseAndStoreAtoAccount(supabase as never, id, csv.id, csv.text, names)
        out(`  re-run ATO account analysis: ${outcome.ok ? `stored (${outcome.kind})` : `not stored: ${outcome.error}`}`)
      }
    }
  }
  out('')
  out(`${clients?.length ?? 0} clients; ${affected} with dates unread in the stored analysis or a CSV; ${csvAffected} with such a CSV.`)
}, 600_000)
