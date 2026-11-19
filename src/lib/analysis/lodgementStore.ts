import type { getSupabaseServerClient } from '@/lib/supabase/server'
import { DOCUMENT_CATEGORIES } from '@/lib/constants'
import { isActivityStatementCsv, parseActivityStatementCsv } from './parseActivityStatement'
import { computeLateLodgement, reanalyseStoredRows } from './computeLateLodgement'
import { loadDpnNoticeFigures } from '@/lib/dpn/loadNoticeFigures'
import { canSummarise, generateLodgementAiSummary, isClaudeSummary } from '@/lib/ai/lodgementSummary'
import { icaViewOf } from '@/lib/ica/view'
import { aiSummariesEnabled } from '@/lib/ai/openrouterClient'
import { ATO_UPLOAD_EXTENSIONS, atoAccountText } from '@/lib/ica/upload'
import { verifyAndStoreDocument } from '@/lib/ica/verifyStore'
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
 * The newest activity statement export (CSV, or RBA ICA spreadsheet) among the client's integrated client
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
    // The ATO's CSV, or an RBA ICA spreadsheet (.xlsx) read as that CSV (ica/upload.ts).
    const readable = doc.file_type === 'text/csv' || ATO_UPLOAD_EXTENSIONS.test(doc.original_filename)
    if (!readable || !doc.file_path) continue
    const { data: blob, error } = await supabase.storage.from('documents').download(doc.file_path)
    if (error || !blob) continue
    const text = await atoAccountText(new Uint8Array(await blob.arrayBuffer()))
    if (text !== null && isActivityStatementCsv(text)) {
      return { doc: { id: doc.id, file_path: doc.file_path, original_filename: doc.original_filename }, text }
    }
  }
  return null
}

export type AnalyseOutcome =
  | { ok: true; row: LodgementRow; result: ReturnType<typeof computeLateLodgement> }
  | { ok: false; error: string }

/** Is there anything for a summary to explain? Never for a file whose dates could not be read: its figures are not shown. */
function needsSummary(result: ReturnType<typeof computeLateLodgement>): boolean {
  if (result.unparsedDateRows > 0) return false
  return result.dpnRisk.totalGrossLate > 0 || result.summary.numberOfLateLodgements > 0
}

/**
 * Analyse the export and store the result against its document. With
 * `verify`, the file is then checked against the ATO's own balance
 * (ica/verifyStore.ts; automatic runs check it in their own step). With
 * `aiSummary`, a summary is written too (best effort) — only for a VERIFIED
 * file; otherwise the stored summary is cleared, because it described the
 * figures before this run.
 */
export async function analyseAndStoreLodgement(
  supabase: ServerClient,
  clientId: string,
  file: ActivityStatementFile,
  options: { aiSummary: boolean; verify?: boolean },
): Promise<AnalyseOutcome> {
  let parsed
  let result
  try {
    parsed = parseActivityStatementCsv(file.text)
    result = computeLateLodgement(parsed)
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'The CSV could not be read.' }
  }

  const now = new Date().toISOString()
  const { data: stored, error } = await supabase
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
        // Above 0 the analysis failed: shown as such, and refused by the prediction.
        unparsed_date_rows: result.unparsedDateRows,
        rows: result.rows as unknown as Record<string, unknown>[],
        warnings: result.warnings as unknown as Record<string, unknown>[],
        dpn_risk: result.dpnRisk as unknown as Record<string, unknown>,
        debt_breakdown: result.debtBreakdown as unknown as Record<string, unknown>,
        ai_summary: null,
        ai_summary_generated_at: null,
        ai_summary_model: null,
        analysed_at: now,
      },
      { onConflict: 'document_id' },
    )
    .select()
    .single()

  if (error || !stored) {
    console.error('[lodgement] upsert failed', error?.code)
    return { ok: false, error: 'Failed to persist analysis.' }
  }

  // Checked against the ATO's own balance: only a verified file's figures are explained.
  let verified = false
  if (options.verify) {
    const check = await verifyAndStoreDocument(supabase, clientId, file.doc.id)
    verified = check.ok && check.status === 'verified'
  }

  let aiText: string | null = null
  let aiModel: string | null = null
  if (options.aiSummary && verified && aiSummariesEnabled() && needsSummary(result)) {
    try {
      // Only proven figures: the account as verified, and every current notice proven.
      const { data: checked } = await supabase.from('lodgement_analyses').select('rows, statement_label, ica_status, ica_forced, ica_check').eq('id', stored.id).single()
      const account = checked ? icaViewOf({ rows: checked.rows, label: checked.statement_label, ica_status: checked.ica_status, ica_forced: checked.ica_forced, ica_check: checked.ica_check }) : null
      const notices = await loadDpnNoticeFigures(supabase, clientId).catch(() => null)
      if (canSummarise(account, notices)) {
        const ai = await generateLodgementAiSummary({ dpnRisk: result.dpnRisk, account, summary: result.summary, notices })
        aiText = ai.text
        aiModel = ai.model
      }
    } catch (err) {
      console.error('[lodgement] AI summary failed', err instanceof Error ? err.name : 'unknown')
    }
  }

  if (aiText) {
    await supabase
      .from('lodgement_analyses')
      .update({ ai_summary: aiText, ai_summary_generated_at: new Date().toISOString(), ai_summary_model: aiModel })
      .eq('id', stored.id)
  }
  const { data: row } = await supabase.from('lodgement_analyses').select('*').eq('id', stored.id).single()
  return { ok: true, row: row ?? stored, result }
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
    .select('id, ai_summary, ai_summary_generated_at, ai_summary_model, rows, dpn_risk, debt_breakdown, number_of_late_lodgements, cumulative_days_late, statement_label, ica_status, ica_forced, ica_check')
    .eq('client_id', clientId)
    .order('analysed_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!row) return { kind: 'none' }
  // Only a file verified against the ATO's own balance is explained (migration 0058).
  if (row.ica_status !== 'verified') return { kind: 'not_needed' }
  // A summary written before the switch to Claude did not pass the figure check: not shown, written again.
  if (row.ai_summary && row.ai_summary_generated_at && isClaudeSummary(row.ai_summary_model)) {
    return { kind: 'generated', text: row.ai_summary, generatedAt: row.ai_summary_generated_at }
  }

  // The stored totals are whatever the code computed on the day: the current
  // code runs over the stored rows instead (the report does the same).
  const fresh = reanalyseStoredRows(row.rows)
  // Dates that cannot be read: there are no figures to explain.
  if (fresh && fresh.unparsedDateRows > 0) return { kind: 'not_needed' }
  const dpnRisk = fresh?.dpnRisk ?? (row.dpn_risk as unknown as ReturnType<typeof computeLateLodgement>['dpnRisk'])
  const summary = fresh?.summary ?? {
    numberOfLateLodgements: row.number_of_late_lodgements,
    cumulativeDaysLate: row.cumulative_days_late,
  }
  if (!(dpnRisk?.totalGrossLate > 0) && !(summary.numberOfLateLodgements > 0)) return { kind: 'not_needed' }
  if (!aiSummariesEnabled()) return { kind: 'not_needed' }
  // Only proven figures: the account as verified, and every current notice proven.
  const account = icaViewOf({ rows: row.rows, label: row.statement_label, ica_status: row.ica_status, ica_forced: row.ica_forced, ica_check: row.ica_check })
  const notices = await loadDpnNoticeFigures(supabase, clientId).catch(() => null)
  if (!canSummarise(account, notices)) return { kind: 'not_needed' }

  try {
    const ai = await generateLodgementAiSummary({ dpnRisk, account, summary, notices })
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
