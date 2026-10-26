import type { getSupabaseServerClient } from '@/lib/supabase/server'
import { parseActivityStatementCsv } from '../parseActivityStatement'
import { computeLateLodgement } from '../computeLateLodgement'
import { debtComposition } from '../debtComposition'
import { reconciliationGap } from '../debtReconciliation'
import { ATO_ACCOUNT_CATEGORIES, entityMatches, readAtoAccountHeader, type AtoAccountKind } from '../atoAccountKind'
import { analyseAtoAccount } from '.'
import { calendarDay, type AccountRow } from './engine'
import type { Database, Json } from '@/types/database'
import { aiSummariesEnabled } from '@/lib/ai/openrouterClient'
import { generateAtoAccountSummary } from '@/lib/ai/atoAccountSummary'
import { isClaudeSummary } from '@/lib/ai/lodgementSummary'
import type { IncomeTaxSummary } from './incomeTax'
import type { SuperGuaranteeSummary } from './superGuarantee'

/**
 * Server-only. Each ATO account CSV's analysis, stored in
 * ato_account_analyses (migration 0038), one row per file.
 *
 * Income tax and superannuation guarantee files: the shared engine (index.ts).
 * Activity statement files: their balance and composition, from the activity
 * statement analysis's own code, for the ATO accounts panel. That is a second,
 * separate record: lodgement_analyses — what the SBR prediction reads — is
 * never written here.
 */

type ServerClient = ReturnType<typeof getSupabaseServerClient>
export type AtoAccountAnalysisRow = Database['public']['Tables']['ato_account_analyses']['Row']

export interface AtoAccountFile {
  id: string
  file_path: string
}

/** The ATO account CSVs on the client file (all three slots). */
export async function listAtoAccountFiles(supabase: ServerClient, clientId: string): Promise<AtoAccountFile[]> {
  const { data } = await supabase
    .from('documents')
    .select('id, file_path, file_type, original_filename')
    .eq('client_id', clientId)
    .in('doc_category', ATO_ACCOUNT_CATEGORIES as string[])
  return (data ?? [])
    .filter((d) => d.file_path && (d.file_type === 'text/csv' || d.original_filename.toLowerCase().endsWith('.csv')))
    .map((d) => ({ id: d.id, file_path: d.file_path }))
}

/** The names the client goes by, for checking line 2 of each export. */
export async function clientNamesFor(supabase: ServerClient, clientId: string): Promise<(string | null)[]> {
  const [{ data: client }, { data: company }] = await Promise.all([
    supabase.from('clients').select('name').eq('id', clientId).maybeSingle(),
    supabase.from('company_details').select('company_name, trust_name').eq('client_id', clientId).maybeSingle(),
  ])
  return [client?.name ?? null, company?.company_name ?? null, company?.trust_name ?? null]
}

/** Rows as stored: dates as yyyy-mm-dd, only what the pages and exports show. */
function storedRows(rows: readonly AccountRow[]) {
  return rows.map((r) => ({
    rowIndex: r.rowIndex,
    processedDate: calendarDay(r.processedDate),
    effectiveDate: calendarDay(r.effectiveDate),
    description: r.description,
    debit: r.debit,
    credit: r.credit,
    balance: r.balance,
    line: r.line,
    kind: r.lodgementType,
  }))
}

export type StoreOutcome = { ok: true; kind: AtoAccountKind } | { ok: false; error: string }

/** Analyse one ATO account CSV and store the result against its document. Never throws. */
export async function analyseAndStoreAtoAccount(
  supabase: ServerClient,
  clientId: string,
  documentId: string,
  text: string,
  names: readonly (string | null)[],
): Promise<StoreOutcome> {
  const header = readAtoAccountHeader(text)
  if (header.kind === 'unrecognised') return { ok: false, error: 'Account type not recognised yet' }

  let record: Omit<Database['public']['Tables']['ato_account_analyses']['Insert'], 'client_id' | 'document_id'>
  try {
    if (header.kind === 'activity_statement') {
      const parsed = parseActivityStatementCsv(text)
      const result = computeLateLodgement(parsed)
      const db = result.debtBreakdown
      record = {
        account_kind: 'activity_statement',
        account_label: parsed.statementLabel,
        entity_name: parsed.companyName,
        balance: db.atoBalance,
        balance_date: db.atoBalanceDate,
        unexplained_difference: reconciliationGap(db),
        // An activity statement is never locked: an amber warning only (lodgement page).
        needs_review: false,
        composition: debtComposition(result.rows, db) as unknown as Json,
        summary: {} as Json,
        rows: [] as unknown as Json,
        warnings: result.warnings as unknown as Json,
      }
    } else {
      const a = analyseAtoAccount(text)
      record = {
        account_kind: a.kind,
        account_label: a.label,
        entity_name: a.entityName,
        balance: a.balance,
        balance_date: a.balanceDate,
        unexplained_difference: a.unexplainedDifference,
        needs_review: a.needsReview,
        composition: a.composition as unknown as Json,
        summary: { ...a.summary, openingBalance: a.openingBalance, statementDate: a.statementDate } as unknown as Json,
        rows: storedRows(a.rows) as unknown as Json,
        warnings: [] as unknown as Json,
      }
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'The CSV could not be read.' }
  }

  // Review fields are left out, so a re-run keeps who reviewed it and when.
  const { error } = await supabase.from('ato_account_analyses').upsert(
    {
      client_id: clientId,
      document_id: documentId,
      ...record,
      entity_matches: entityMatches(record.entity_name ?? null, names),
      ai_summary: null,
      ai_summary_generated_at: null,
      ai_summary_model: null,
      analysed_at: new Date().toISOString(),
    },
    { onConflict: 'document_id' },
  )
  if (error) {
    console.error('[ato-account] upsert failed', error.code)
    return { ok: false, error: 'Failed to store the analysis.' }
  }
  return { ok: true, kind: header.kind }
}

// ─── The ATO accounts panel ───────────────────────────────────────────────────

export interface AtoAccountSummaryRow {
  id: string
  documentId: string
  kind: AtoAccountKind
  label: string
  balance: number | null
  balanceDate: string | null
  needsReview: boolean
  reviewedAt: string | null
  entityMatches: boolean | null
  /** Other files for the same account (same line 1) that this one replaces. */
  olderFiles: number
}

export interface AtoAccountsOverview {
  accounts: AtoAccountSummaryRow[]
  /** The newest balance of each account, credits netted off; null with no balances. */
  totalDebt: number | null
}

/**
 * Each account once — the newest file per line-1 label (latest balance date,
 * then latest analysed) — and their total, net of credits (the ATO offsets
 * them). Pure, over stored rows.
 */
export function atoAccountsOverview(rows: readonly AtoAccountAnalysisRow[]): AtoAccountsOverview {
  const byLabel = new Map<string, AtoAccountAnalysisRow[]>()
  for (const r of rows) {
    const key = r.account_label.trim().toLowerCase()
    byLabel.set(key, [...(byLabel.get(key) ?? []), r])
  }
  const order: Record<AtoAccountKind, number> = { activity_statement: 0, income_tax: 1, super_guarantee: 2 }
  const accounts = [...byLabel.values()]
    .map((files) => {
      const newest = [...files].sort(
        (a, b) => (b.balance_date ?? '').localeCompare(a.balance_date ?? '') || b.analysed_at.localeCompare(a.analysed_at),
      )[0]
      return {
        id: newest.id,
        documentId: newest.document_id,
        kind: newest.account_kind as AtoAccountKind,
        label: newest.account_label,
        balance: newest.balance === null ? null : Number(newest.balance),
        balanceDate: newest.balance_date,
        needsReview: newest.needs_review,
        reviewedAt: newest.reviewed_at,
        entityMatches: newest.entity_matches,
        olderFiles: files.length - 1,
      }
    })
    .sort((a, b) => order[a.kind] - order[b.kind] || a.label.localeCompare(b.label, 'en', { numeric: true }))
  const withBalance = accounts.filter((a) => a.balance !== null)
  const totalDebt = withBalance.length ? Math.round(withBalance.reduce((s, a) => s + a.balance!, 0) * 100) / 100 : null
  return { accounts, totalDebt }
}

export async function loadAtoAccounts(supabase: ServerClient, clientId: string): Promise<AtoAccountsOverview> {
  const { data } = await supabase.from('ato_account_analyses').select('*').eq('client_id', clientId)
  return atoAccountsOverview(data ?? [])
}

/** Whether any ATO account CSV on the client file has no analysis yet. */
export async function hasUnanalysedAtoAccounts(supabase: ServerClient, clientId: string): Promise<boolean> {
  const [files, { data: analysed }] = await Promise.all([
    listAtoAccountFiles(supabase, clientId),
    supabase.from('ato_account_analyses').select('document_id').eq('client_id', clientId),
  ])
  const done = new Set((analysed ?? []).map((a) => a.document_id))
  return files.some((f) => !done.has(f.id))
}

// ─── Which activity statement the SBR factors come from ───────────────────────

/**
 * "Factors come from Activity statement 002 (latest upload); this client also
 * has: Activity statement 001." Null with one activity statement account
 * (nothing to point out) or none. Labels are line 1 as printed.
 */
export function factorsSourceNote(current: string | null, labels: readonly string[]): string | null {
  if (!current) return null
  const key = (s: string) => s.trim().toLowerCase()
  // One per account, however it is spelt; the first spelling seen is shown.
  const byKey = new Map<string, string>()
  for (const l of labels) if (!byKey.has(key(l))) byKey.set(key(l), l.trim())
  byKey.delete(key(current))
  const others = [...byKey.values()].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
  if (others.length === 0) return null
  return `Factors come from ${current.trim()} (latest upload); this client also has: ${others.join(', ')}.`
}

/** The note for a client: the lodgement analysis's account against every activity statement account on file. */
export async function loadFactorsSourceNote(supabase: ServerClient, clientId: string, current: string | null): Promise<string | null> {
  if (!current) return null
  const [{ data: analysed }, { data: docs }] = await Promise.all([
    supabase.from('ato_account_analyses').select('account_label').eq('client_id', clientId).eq('account_kind', 'activity_statement'),
    supabase.from('documents').select('ato_account_label').eq('client_id', clientId).eq('ato_account_kind', 'activity_statement'),
  ])
  const labels = [...(analysed ?? []).map((a) => a.account_label), ...(docs ?? []).map((d) => d.ato_account_label)].filter(
    (l): l is string => typeof l === 'string' && l.trim() !== '',
  )
  return factorsSourceNote(current, labels)
}

// ─── The AI summary ───────────────────────────────────────────────────────────

export type AtoSummaryOutcome =
  | { kind: 'generated'; text: string; generatedAt: string }
  | { kind: 'not_needed' }
  | { kind: 'locked' }
  | { kind: 'none' }
  | { kind: 'failed' }

/**
 * The AI summary of an income tax or super guarantee analysis, written now if
 * it has none (atoAccountSummary.ts), from the stored figures — the CSV is not
 * read again. Not while the analysis needs review: figures with more than
 * $1,000 unexplained are not summarised until someone has looked at them.
 * Off unless AI_SUMMARIES_ENABLED.
 */
export async function ensureAtoAccountSummary(supabase: ServerClient, clientId: string, analysisId: string): Promise<AtoSummaryOutcome> {
  const { data: row } = await supabase
    .from('ato_account_analyses')
    .select('id, account_kind, balance, balance_date, summary, needs_review, reviewed_at, ai_summary, ai_summary_generated_at, ai_summary_model')
    .eq('id', analysisId)
    .eq('client_id', clientId)
    .maybeSingle()
  if (!row) return { kind: 'none' }
  if (row.account_kind !== 'income_tax' && row.account_kind !== 'super_guarantee') return { kind: 'not_needed' }
  if (row.needs_review && !row.reviewed_at) return { kind: 'locked' }
  if (row.ai_summary && row.ai_summary_generated_at && isClaudeSummary(row.ai_summary_model)) {
    return { kind: 'generated', text: row.ai_summary, generatedAt: row.ai_summary_generated_at }
  }
  if (!aiSummariesEnabled()) return { kind: 'not_needed' }

  try {
    const account = { balance: row.balance === null ? null : Number(row.balance), balanceDate: row.balance_date }
    const ai =
      row.account_kind === 'income_tax'
        ? await generateAtoAccountSummary({ ...account, kind: 'income_tax', summary: row.summary as unknown as IncomeTaxSummary })
        : await generateAtoAccountSummary({ ...account, kind: 'super_guarantee', summary: row.summary as unknown as SuperGuaranteeSummary })
    const now = new Date().toISOString()
    await supabase
      .from('ato_account_analyses')
      .update({ ai_summary: ai.text, ai_summary_generated_at: now, ai_summary_model: ai.model })
      .eq('id', row.id)
    return { kind: 'generated', text: ai.text, generatedAt: now }
  } catch (err) {
    console.error('[ato-account] AI summary failed', err instanceof Error ? err.name : 'unknown')
    return { kind: 'failed' }
  }
}
