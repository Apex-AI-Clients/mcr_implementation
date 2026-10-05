import type { getSupabaseServerClient } from '@/lib/supabase/server'
import { toStoredSlot } from './halves'
import type { ColumnFailure } from './coverage'
import type { ExtractionWarning, StoredStatementSlot } from './types'

/**
 * Server-only. Every stored statement slot for a client, read as halves
 * (legacy rows included — see halves.ts). The one way readers load
 * financial_statements, so none of them meets a half-empty row unprepared.
 */

type ServerClient = ReturnType<typeof getSupabaseServerClient>

export async function loadStoredSlots(
  supabase: ServerClient,
  clientId: string,
): Promise<StoredStatementSlot[]> {
  const { data, error } = await supabase
    .from('financial_statements')
    .select('*')
    .eq('client_id', clientId)
    .order('financial_year', { ascending: true })
  if (error) throw new Error(`Failed to load statements: ${error.message}`)
  return (data ?? []).map(toStoredSlot)
}

/**
 * Columns a document prints but whose extraction failed even on a retry, as
 * recorded on its extraction record. A failed read returns none.
 */
export async function loadColumnFailures(supabase: ServerClient, clientId: string): Promise<ColumnFailure[]> {
  const { data, error } = await supabase
    .from('financial_document_extractions')
    .select('warnings')
    .eq('client_id', clientId)
  if (error) return []
  const out: ColumnFailure[] = []
  for (const record of data ?? []) {
    const warnings = Array.isArray(record.warnings) ? (record.warnings as unknown as ExtractionWarning[]) : []
    for (const w of warnings) {
      if (w.kind !== 'column_not_extracted' || typeof w.financialYear !== 'number' || !w.sourceColumn) continue
      for (const half of w.halves ?? ['income_statement', 'balance_sheet']) {
        out.push({ financialYear: w.financialYear, sourceColumn: w.sourceColumn, half })
      }
    }
  }
  return out
}
