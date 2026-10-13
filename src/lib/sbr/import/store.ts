/**
 * Database reads and writes for the historical-case import. Server-side only
 * (service-role client). The saves go through the two SQL functions of
 * migration 0028, each one transaction.
 */
import type { getSupabaseServerClient } from '@/lib/supabase/server'
import type { Database } from '@/types/database'
import type { ApplyPayload, ImportHistoryCounts } from './payload'
import { toRpcArgs } from './payload'
import type { CaseRecord, ExistingCase, RawRow } from './types'

type ServerClient = ReturnType<typeof getSupabaseServerClient>
type CaseRow = Database['public']['Tables']['sbr_historical_cases']['Row']
type ImportRow = Database['public']['Tables']['sbr_case_imports']['Row']

/** The stored case columns the import compares and corrects. */
const CASE_COLUMNS = [
  'id',
  'name_key',
  'excluded',
  'excluded_reason',
  'client_name',
  'dpn',
  'payment_plan_type',
  'term_months',
  'director_loan_at_appointment',
  'director_loan_raw',
  'director_loan_receivable_amount',
  'director_loan_payable_amount',
  'cumulative_days_late',
  'number_of_late_lodgements',
  'days_since_last_payment',
  'outcome_percent',
  'accepted',
  'creditor_amount',
  'sbr_payment',
  'business_type',
  'number_of_creditors',
  'raw',
].join(', ')

/**
 * Every stored case, as the import compares against it.
 *
 * Values are kept exactly as the database returned them: a correction sends
 * them back as `expected`, and sbr_apply_case_import refuses the import when
 * they no longer match.
 */
export async function loadExistingCases(supabase: ServerClient): Promise<ExistingCase[]> {
  const { data, error } = await supabase.from('sbr_historical_cases').select(CASE_COLUMNS)
  if (error) throw new Error(`sbr_historical_cases read failed: ${error.message}`)
  return ((data ?? []) as unknown as CaseRow[]).map(toExistingCase)
}

export function toExistingCase(row: CaseRow): ExistingCase {
  const record: CaseRecord = {
    client_name: row.client_name,
    dpn: row.dpn,
    payment_plan_type: row.payment_plan_type as CaseRecord['payment_plan_type'],
    term_months: row.term_months,
    director_loan_at_appointment: row.director_loan_at_appointment,
    director_loan_raw: row.director_loan_raw,
    director_loan_receivable_amount: row.director_loan_receivable_amount,
    director_loan_payable_amount: row.director_loan_payable_amount,
    cumulative_days_late: row.cumulative_days_late,
    number_of_late_lodgements: row.number_of_late_lodgements,
    days_since_last_payment: row.days_since_last_payment,
    outcome_percent: row.outcome_percent,
    accepted: row.accepted,
    creditor_amount: row.creditor_amount,
    sbr_payment: row.sbr_payment,
    business_type: row.business_type,
    number_of_creditors: row.number_of_creditors,
    raw: row.raw as RawRow | null,
  }
  return {
    id: row.id,
    // Generated from client_name (0028); never null for a stored row.
    name_key: row.name_key ?? '',
    excluded: row.excluded,
    excluded_reason: row.excluded_reason,
    record,
  }
}

/**
 * Why a save or undo was refused, as the routes answer it. `changed`: the
 * data moved since the preview (40001, or a new name now taken, 23505).
 * `undone` / `later_upload`: undo refused (55000). `not_found`: P0002.
 */
export type StoreRefusal = 'changed' | 'undone' | 'later_upload' | 'not_found'

export class StoreRefusedError extends Error {
  constructor(readonly refusal: StoreRefusal) {
    super(refusal)
  }
}

export async function applyImport(supabase: ServerClient, payload: ApplyPayload): Promise<string> {
  const { data, error } = await supabase.rpc('sbr_apply_case_import', toRpcArgs(payload))
  if (error) {
    if (error.code === '40001' || error.code === '23505') throw new StoreRefusedError('changed')
    throw new Error(`sbr_apply_case_import failed: ${error.code ?? 'unknown'}`)
  }
  return data as string
}

export async function undoImport(
  supabase: ServerClient,
  importId: string,
  undoneBy: string,
): Promise<{ deleted: number; restored: number }> {
  const { data, error } = await supabase.rpc('sbr_undo_case_import', {
    p_import_id: importId,
    p_undone_by: undoneBy,
  })
  if (error) {
    if (error.code === 'P0002') throw new StoreRefusedError('not_found')
    if (error.code === '55000') {
      throw new StoreRefusedError(/already undone/.test(error.message) ? 'undone' : 'later_upload')
    }
    throw new Error(`sbr_undo_case_import failed: ${error.code ?? 'unknown'}`)
  }
  return data as { deleted: number; restored: number }
}

export interface ImportHistoryEntry {
  id: string
  uploadedAt: string
  uploadedBy: string
  fileName: string
  counts: Partial<ImportHistoryCounts>
  undoneAt: string | null
  undoneBy: string | null
}

/** Every confirmed upload, newest first. */
export async function listImports(supabase: ServerClient): Promise<ImportHistoryEntry[]> {
  const { data, error } = await supabase
    .from('sbr_case_imports')
    .select('id, uploaded_at, uploaded_by, file_name, counts, undone_at, undone_by')
    .order('uploaded_at', { ascending: false })
  if (error) throw new Error(`sbr_case_imports read failed: ${error.message}`)
  return ((data ?? []) as ImportRow[]).map((row) => ({
    id: row.id,
    uploadedAt: row.uploaded_at,
    uploadedBy: row.uploaded_by,
    fileName: row.file_name,
    counts: (row.counts ?? {}) as Partial<ImportHistoryCounts>,
    undoneAt: row.undone_at,
    undoneBy: row.undone_by,
  }))
}
