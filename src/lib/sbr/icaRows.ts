import type { getSupabaseServerClient } from '@/lib/supabase/server'
import { computeLateLodgement } from '@/lib/analysis/computeLateLodgement'
import { parseActivityStatementCsv } from '@/lib/analysis/parseActivityStatement'
import type { IcaRow } from './creditorDebt'

/**
 * Server-only. The ATO account rows the creditor debt is read from.
 *
 * The stored lodgement analysis holds the rows, but analyses saved before the
 * CSV line-ending fix carry no balance on any row (the Balance cell kept a
 * stray quote and read as empty). Those are re-read from the uploaded CSV
 * itself, with the fixed parser — no need to re-run the analysis.
 */

type ServerClient = ReturnType<typeof getSupabaseServerClient>

export interface StoredLodgement {
  document_id: string | null
  rows: unknown
}

export interface IcaRowsResult {
  rows: IcaRow[] | null
  /** Where the rows came from, for the log. */
  from: 'analysis' | 'csv' | 'none'
}

const calendarDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T00:00:00.000Z`

export function hasBalance(rows: readonly IcaRow[] | null | undefined): boolean {
  return Array.isArray(rows) && rows.some((r) => typeof r.balance === 'number')
}

export async function loadIcaRows(supabase: ServerClient, lodgement: StoredLodgement | null): Promise<IcaRowsResult> {
  if (!lodgement) return { rows: null, from: 'none' }
  const stored = Array.isArray(lodgement.rows) ? (lodgement.rows as IcaRow[]) : null
  if (hasBalance(stored) || !lodgement.document_id) return { rows: stored, from: 'analysis' }

  try {
    const { data: doc } = await supabase.from('documents').select('file_path').eq('id', lodgement.document_id).maybeSingle()
    if (!doc?.file_path) return { rows: stored, from: 'analysis' }
    const { data: blob, error } = await supabase.storage.from('documents').download(doc.file_path)
    if (error || !blob) return { rows: stored, from: 'analysis' }
    // Re-run the analysis's own row step, not just the parser: the parser does
    // not classify rows, and without "Payment" rows the days since the last
    // payment read as "no payments ever" (9999), which moved the prediction.
    const reparsed = computeLateLodgement(parseActivityStatementCsv(await blob.text())).rows.map((row) => ({
      ...row,
      // The parser's dates are local midnight; keep the calendar day whatever
      // the server's time zone (as stored analyses carry ISO strings).
      processedDate: row.processedDate ? calendarDay(row.processedDate) : null,
    })) as unknown as IcaRow[]
    return hasBalance(reparsed) ? { rows: reparsed, from: 'csv' } : { rows: stored, from: 'analysis' }
  } catch (err) {
    console.error('[creditor-debt] could not re-read the ATO account CSV', err)
    return { rows: stored, from: 'analysis' }
  }
}
