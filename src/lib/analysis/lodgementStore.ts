import type { getSupabaseServerClient } from '@/lib/supabase/server'
import { DOCUMENT_CATEGORIES } from '@/lib/constants'
import { isActivityStatementCsv, parseActivityStatementCsv } from './parseActivityStatement'
import { computeLateLodgement, reanalyseStoredRows } from './computeLateLodgement'
import { loadDpnNoticeFigures } from '@/lib/dpn/loadNoticeFigures'
import { generateLodgementAiSummary, isClaudeSummary } from '@/lib/ai/lodgementSummary'
import { aiSummariesEnabled } from '@/lib/ai/openrouterClient'
import type { Database } from '@/types/database'

/**
 * Server-only. Finding a client's ATO activity statement export, analysing it,
 * and storing the analysis (lodgement_analyses).
 *
 * The analysis itself is arithmetic. The AI summary is separate and optional:
 * automatic runs (on upload or delete) store the figures only, and the summary
 * is generated when staff open the page, by Claude via OpenRouter (Anthropic
 * only, no data retained), from the computed figures only — never the CSV.
 * Off unless AI_SUMMARIES_ENABLED.
 */

type ServerClient = ReturnType<typeof getSupabaseServerClient>
type LodgementRow = Database['public']['Tables']['lodgement_analyses']['Row']

export interface ActivityStatementFile {
  doc: { id: string; file_path: string; original_filename: string }
  text: string
}

/** CSVs checked, newest first, before giving up. */
const MAX_CSVS_CHECKED = 10

/**
 * The newest activity statement export among the client's integrated client
 * account files, recognised by its content (label and header), not its
 * filename — a renamed export is still found, and an income tax or super
 * account export is not mistaken for one.
 */
export async function findActivityStatementCsv(
  supabase: ServerClient,
  clientId: string,
): Promise<ActivityStatementFile | null> {
  const { data: docs } = await supabase
    .from('documents')
    .select('id, file_path, original_filename, file_type')
    .eq('client_id', clientId)
    .eq('doc_category', DOCUMENT_CATEGORIES.INTEGRATED_CLIENT_ACCOUNT)
    .order('uploaded_at', { ascending: false })
    .limit(MAX_CSVS_CHECKED)

  for (const doc of docs ?? []) {
    const isCsv = doc.file_type === 'text/csv' || doc.original_filename.toLowerCase().endsWith('.csv')
    if (!isCsv || !doc.file_path) continue
    const { data: blob, error } = await supabase.storage.from('documents').download(doc.file_path)
    if (error || !blob) continue
    const text = await blob.text()
    if (isActivityStatementCsv(text)) {
      return { doc: { id: doc.id, file_path: doc.file_path, original_filename: doc.original_filename }, text }
    }
  }
  return null
}

export type AnalyseOutcome =
  | { ok: true; row: LodgementRow; result: ReturnType<typeof computeLateLodgement> }
  | { ok: false; error: string }

/** Is there anything for a summary to explain? */
function needsSummary(result: ReturnType<typeof computeLateLodgement>): boolean {
  return result.dpnRisk.totalGrossLate > 0 || result.summary.numberOfLateLodgements > 0
}

/**
 * Analyse the export and store the result against its document. With
 * `aiSummary`, a summary is generated too (best effort); without, the stored
 * summary is cleared, because it described the figures before this run.
 */
export async function analyseAndStoreLodgement(
  supabase: ServerClient,
  clientId: string,
  file: ActivityStatementFile,
  options: { aiSummary: boolean },
): Promise<AnalyseOutcome> {
  let parsed
  let result
  try {
    parsed = parseActivityStatementCsv(file.text)
    result = computeLateLodgement(parsed)
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'The CSV could not be read.' }
  }

  let aiText: string | null = null
  let aiModel: string | null = null
  if (options.aiSummary && aiSummariesEnabled() && needsSummary(result)) {
    try {
      const ai = await generateLodgementAiSummary({
        dpnRisk: result.dpnRisk,
        debtBreakdown: result.debtBreakdown,
        summary: result.summary,
        // The ATO's own notices, when on file, instead of the estimate.
        notices: await loadDpnNoticeFigures(supabase, clientId).catch(() => null),
      })
      aiText = ai.text
      aiModel = ai.model
    } catch (err) {
      console.error('[lodgement] AI summary failed', err instanceof Error ? err.name : 'unknown')
    }
  }

  const now = new Date().toISOString()
  const { data: row, error } = await supabase
    .from('lodgement_analyses')
    .upsert(
      {
        client_id: clientId,
        document_id: file.doc.id,
        source_filename: file.doc.original_filename,
        statement_label: parsed.statementLabel,
        company_name_in_csv: parsed.companyName,
        row_count: result.rows.length,
        number_of_late_lodgements: result.summary.numberOfLateLodgements,
        cumulative_days_late: result.summary.cumulativeDaysLate,
        rows: result.rows as unknown as Record<string, unknown>[],
        warnings: result.warnings as unknown as Record<string, unknown>[],
        dpn_risk: result.dpnRisk as unknown as Record<string, unknown>,
        debt_breakdown: result.debtBreakdown as unknown as Record<string, unknown>,
        ai_summary: aiText,
        ai_summary_generated_at: aiText ? now : null,
        ai_summary_model: aiModel,
        analysed_at: now,
      },
      { onConflict: 'document_id' },
    )
    .select()
    .single()

  if (error || !row) {
    console.error('[lodgement] upsert failed', error?.code)
    return { ok: false, error: 'Failed to persist analysis.' }
  }
  return { ok: true, row, result }
}

export type SummaryOutcome =
  | { kind: 'generated'; text: string; generatedAt: string }
  | { kind: 'not_needed' }
  | { kind: 'none' }
  | { kind: 'failed' }

/**
 * The summary for the client's latest stored analysis, generated now if it
 * has none — when staff open the page after an automatic run. Uses the stored
 * figures; the CSV is not read again.
 */
export async function ensureLodgementSummary(supabase: ServerClient, clientId: string): Promise<SummaryOutcome> {
  const { data: row } = await supabase
    .from('lodgement_analyses')
    .select('id, ai_summary, ai_summary_generated_at, ai_summary_model, rows, dpn_risk, debt_breakdown, number_of_late_lodgements, cumulative_days_late')
    .eq('client_id', clientId)
    .order('analysed_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!row) return { kind: 'none' }
  // A summary written before the switch to Claude did not pass the figure check: not shown, written again.
  if (row.ai_summary && row.ai_summary_generated_at && isClaudeSummary(row.ai_summary_model)) {
    return { kind: 'generated', text: row.ai_summary, generatedAt: row.ai_summary_generated_at }
  }

  // The stored totals are whatever the code computed on the day: the current
  // code runs over the stored rows instead (the report does the same).
  const fresh = reanalyseStoredRows(row.rows)
  const dpnRisk = fresh?.dpnRisk ?? (row.dpn_risk as unknown as ReturnType<typeof computeLateLodgement>['dpnRisk'])
  const summary = fresh?.summary ?? {
    numberOfLateLodgements: row.number_of_late_lodgements,
    cumulativeDaysLate: row.cumulative_days_late,
  }
  if (!(dpnRisk?.totalGrossLate > 0) && !(summary.numberOfLateLodgements > 0)) return { kind: 'not_needed' }
  if (!aiSummariesEnabled()) return { kind: 'not_needed' }

  try {
    const ai = await generateLodgementAiSummary({
      dpnRisk,
      debtBreakdown:
        fresh?.debtBreakdown ?? (row.debt_breakdown as unknown as ReturnType<typeof computeLateLodgement>['debtBreakdown']),
      summary,
      notices: await loadDpnNoticeFigures(supabase, clientId).catch(() => null),
    })
    const now = new Date().toISOString()
    await supabase
      .from('lodgement_analyses')
      .update({ ai_summary: ai.text, ai_summary_generated_at: now, ai_summary_model: ai.model })
      .eq('id', row.id)
    return { kind: 'generated', text: ai.text, generatedAt: now }
  } catch (err) {
    console.error('[lodgement] AI summary failed', err instanceof Error ? err.name : 'unknown')
    return { kind: 'failed' }
  }
}
