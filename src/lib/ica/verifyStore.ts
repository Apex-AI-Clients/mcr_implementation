import type { getSupabaseServerClient } from '@/lib/supabase/server'
import { askClaude, icaProposalsEnabled } from '@/lib/ai/openrouterClient'
import { ATO_ACCOUNT_CATEGORIES } from '@/lib/analysis/atoAccountKind'
import { sendDeveloperAlert } from '@/lib/email/resend'
import type { Json } from '@/types/database'
import { analyseIca, type IcaAnalysis } from './index'
import { loadPatterns, savePatterns } from './patternStore'
import { proposeForUnmatched, type ProposalOutcome } from './propose'
import { readIcaFile, readIcaXlsx } from './read'
import { isXlsxBytes } from './csv'
import type { WindowMethod } from './reconcile'
import type { IcaFile, SpreadsheetFigures } from './types'
import type { IcaStatus } from './status'

/**
 * Server-only. Every ATO account file is checked against the ATO's own
 * balance when it is uploaded (autoRun.ts), and the result is stored beside
 * its analyses (migration 0058): only a VERIFIED file's calculated figures are
 * ever shown, exported, or used by the prediction and CVL.
 *
 *   1. The ICA engine reads the file with the known rules and the learned patterns.
 *   2. Any window that does not match goes to Claude (anonymised rows only;
 *      propose.ts); an answer is used only if the balance then matches to the cent.
 *   3. If an RBA ICA spreadsheet for the same account is on file, its late
 *      lodgements (H3/H4) must be ours exactly.
 *   4. Not verified: the developer is alerted (ica_alerts + an email with ids,
 *      dates and counts only) and staff see the rows as printed, "Totals being prepared".
 */

type ServerClient = ReturnType<typeof getSupabaseServerClient>

export const ICA_ENGINE_VERSION = 'ica-2026-11-17'

export type { IcaStatus } from './status'
export { forcedFrom } from './status'

/** What is stored in ica_check: what the check found. Row positions, dates and counts; no row content. */
export interface IcaCheck {
  version: string
  rows: number
  balanceDays: number
  methods: Partial<Record<WindowMethod, number>>
  unmatched: { days: string[]; rowIds: number[]; reason: string }[]
  holdReasons: string[]
  spreadsheet: { lateLodgements: number; cumulativeDaysLate: number; matches: boolean } | null
  lateLodgements: { count: number | null; cumulativeDays: number | null }
  proposals: { days: string[]; status: ProposalOutcome['status']; note: string; model?: string; generationId?: string }[]
}

export interface Verification {
  status: IcaStatus
  analysis: IcaAnalysis
  check: IcaCheck
  /** Accepted Claude readings, by row position. */
  forced: Record<string, boolean>
}

export const statusOf = (a: IcaAnalysis): IcaStatus => (a.file.rows.length === 0 ? 'empty' : a.verified ? 'verified' : 'unverified')

export function checkOf(a: IcaAnalysis, proposals: ProposalOutcome[] = []): IcaCheck {
  const methods: IcaCheck['methods'] = {}
  for (const m of a.reconciliation.matched) methods[m.method] = (methods[m.method] ?? 0) + 1
  return {
    version: ICA_ENGINE_VERSION,
    rows: a.file.rows.length,
    balanceDays: a.reconciliation.balanceDays,
    methods,
    unmatched: a.reconciliation.unmatched.map((u) => ({ days: u.days, rowIds: u.rowIds, reason: u.reason })),
    holdReasons: a.holdReasons,
    spreadsheet: a.spreadsheetCheck
      ? { lateLodgements: a.spreadsheetCheck.spreadsheet.lateLodgements, cumulativeDaysLate: a.spreadsheetCheck.spreadsheet.cumulativeDaysLate, matches: a.spreadsheetCheck.matches }
      : null,
    lateLodgements: { count: a.lateLodgements.count, cumulativeDays: a.lateLodgements.cumulativeDays },
    proposals: proposals.map((p) => ({ days: p.window.days, status: p.status, note: p.note, model: p.model, generationId: p.generationId })),
  }
}

/**
 * The file checked: known rules and learned patterns, then Claude for what
 * is left (unless switched off), then the spreadsheet comparison. Never throws
 * for a Claude failure: the file is then simply not verified.
 */
export async function verifyIcaFile(
  supabase: ServerClient | null,
  file: IcaFile,
  options: { spreadsheet?: SpreadsheetFigures | null; useClaude?: boolean } = {},
): Promise<Verification> {
  const patterns = supabase ? await loadPatterns(supabase) : []
  let analysis = analyseIca(file, { patterns, spreadsheet: options.spreadsheet })
  let outcomes: ProposalOutcome[] = []
  let forced: ReadonlyMap<number, boolean> = new Map()
  if (analysis.reconciliation.unmatched.length > 0 && (options.useClaude ?? true) && icaProposalsEnabled()) {
    const run = await proposeForUnmatched(
      file,
      (prompt) => askClaude({ purpose: 'ica', prompt, maxTokens: 6000, label: 'ica-window', timeoutMs: 120_000 }),
      { patterns },
    )
    outcomes = run.outcomes
    if (outcomes.some((o) => o.status === 'accepted')) {
      forced = run.forced
      analysis = analyseIca(file, { patterns, forced, spreadsheet: options.spreadsheet })
      for (const m of analysis.reconciliation.matched) {
        if (run.reconciliation.matched.some((x) => x.method === 'claude' && x.days.join() === m.days.join())) m.method = 'claude'
      }
      if (supabase) {
        for (const o of outcomes.filter((x) => x.status === 'accepted' && x.patterns?.length)) {
          await savePatterns(supabase, o.patterns!, { model: o.model, generationId: o.generationId }).catch((e) =>
            console.error('[ica] patterns not saved', e instanceof Error ? e.message : 'unknown'),
          )
        }
      }
    }
  }
  // Every row the balance check decided beyond the structures' own readings (learned patterns and accepted
  // Claude readings), so a page re-reading the stored rows gets exactly the verified reading.
  return { status: statusOf(analysis), analysis, check: checkOf(analysis, outcomes), forced: Object.fromEntries(analysis.reconciliation.forced) }
}

/** The ica_* columns for a verification. */
export function verificationRecord(v: Verification) {
  const r = v.analysis.reconciliation
  return {
    ica_status: v.status,
    ica_balance: v.status === 'verified' && r.atoBalance !== null ? r.atoBalance / 100 : null,
    ica_balance_date: v.status === 'verified' ? r.atoBalanceDate : null,
    ica_check: v.check as unknown as Json,
    ica_forced: v.forced as unknown as Json,
    ica_checked_at: new Date().toISOString(),
  }
}

/**
 * An RBA ICA spreadsheet on file for the same account (same line-1 label), if
 * any: its H3/H4 are the second answer key. A spreadsheet is itself checked
 * against its own H3/H4 (read.ts).
 */
export async function spreadsheetFor(supabase: ServerClient, clientId: string, label: string, exceptDocumentId: string): Promise<SpreadsheetFigures | null> {
  const { data: docs } = await supabase
    .from('documents')
    .select('id, file_path, original_filename, file_type')
    .eq('client_id', clientId)
    .in('doc_category', [...ATO_ACCOUNT_CATEGORIES])
  for (const d of docs ?? []) {
    if (d.id === exceptDocumentId || !d.file_path || !/\.xlsx$/i.test(d.original_filename ?? '')) continue
    const { data: blob } = await supabase.storage.from('documents').download(d.file_path)
    if (!blob) continue
    try {
      const sheet = readIcaXlsx(new Uint8Array(await blob.arrayBuffer()))
      if (sheet.spreadsheet && sheet.label.trim().toLowerCase() === label.trim().toLowerCase()) return sheet.spreadsheet
    } catch {
      // Not an RBA ICA spreadsheet.
    }
  }
  return null
}

export type VerifyDocumentOutcome = { ok: true; status: IcaStatus } | { ok: false; error: string }

/**
 * Checks one ATO account document and stores the result on its analyses
 * (lodgement_analyses and ato_account_analyses, whichever it has). Alerts the
 * developer when it is not verified. Never throws.
 */
export async function verifyAndStoreDocument(supabase: ServerClient, clientId: string, documentId: string): Promise<VerifyDocumentOutcome> {
  try {
    const { data: doc } = await supabase.from('documents').select('id, file_path').eq('id', documentId).eq('client_id', clientId).maybeSingle()
    if (!doc?.file_path) return { ok: false, error: 'Document not found' }
    const { data: blob, error } = await supabase.storage.from('documents').download(doc.file_path)
    if (error || !blob) return { ok: false, error: 'The file could not be downloaded' }
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const file = readIcaFile(bytes)
    const spreadsheet = isXlsxBytes(bytes) ? null : await spreadsheetFor(supabase, clientId, file.label, documentId)
    const v = await verifyIcaFile(supabase, file, { spreadsheet })
    const record = verificationRecord(v)
    const [a, b] = await Promise.all([
      supabase.from('lodgement_analyses').update(record).eq('document_id', documentId),
      supabase.from('ato_account_analyses').update(record).eq('document_id', documentId),
    ])
    if (a.error || b.error) return { ok: false, error: 'The check could not be stored' }
    if (v.status === 'unverified') await alertDeveloper(supabase, clientId, documentId, file.kind, v)
    console.log(`[ica] document=${documentId} status=${v.status} unmatched=${v.check.unmatched.length} claude=${v.check.proposals.length}`)
    return { ok: true, status: v.status }
  } catch (err) {
    console.error('[ica] check failed', err instanceof Error ? err.message : 'unknown')
    return { ok: false, error: err instanceof Error ? err.message : 'The check failed' }
  }
}

/** Logs the alert (ica_alerts) and emails the developer: ids, dates and counts only. */
async function alertDeveloper(supabase: ServerClient, clientId: string, documentId: string, kind: string, v: Verification): Promise<void> {
  const windows = v.check.unmatched.map((u) => ({ from: u.days[0], to: u.days[u.days.length - 1], rows: u.rowIds.length, reason: u.reason }))
  const { data: alert } = await supabase
    .from('ica_alerts')
    .insert({ client_id: clientId, document_id: documentId, account_kind: kind, windows: windows as unknown as Json, hold_reasons: v.check.holdReasons })
    .select('id')
    .single()
  const app = process.env.NEXT_PUBLIC_APP_URL ?? ''
  const text = [
    'An ATO account file did not verify against the ATO balance. Its totals are held back ("Totals being prepared").',
    '',
    `Client id: ${clientId}`,
    `Document id: ${documentId}`,
    `Account kind: ${kind}`,
    `Why: ${v.check.holdReasons.join('; ') || 'not verified'}`,
    ...windows.map((w) => `Window ${w.from}${w.to !== w.from ? ` to ${w.to}` : ''}: ${w.rows} rows (${w.reason.replace(/_/g, ' ')})`),
    '',
    `Check it: npm run ica:check -- <the file>   ·   ${app}/clients/${clientId}/lodgement-compliance-analysis`,
  ].join('\n')
  try {
    await sendDeveloperAlert({ subject: `ATO file not verified — client ${clientId.slice(0, 8)}`, text })
    if (alert) await supabase.from('ica_alerts').update({ emailed_at: new Date().toISOString() }).eq('id', alert.id)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown'
    console.error('[ica] alert email failed', message)
    if (alert) await supabase.from('ica_alerts').update({ email_error: message.slice(0, 500) }).eq('id', alert.id)
  }
}
