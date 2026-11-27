import type { getSupabaseServerClient } from '@/lib/supabase/server'
import type { PrintedStatementKind } from './types'
import type { PrintedComparison, SourceChoice } from './compare'

/**
 * Server-only. "Use this source instead" (Gabby, 25 Nov 2026): staff choosing which file a period's
 * profit and loss or balance sheet is taken from, kept in comparison_source_choices (migration 0064).
 * Append-only: the latest row per period and statement counts (compare.ts), the rest is the log of
 * who chose what, when. Before 0064 is applied there are no choices and the rules decide.
 */

type ServerClient = ReturnType<typeof getSupabaseServerClient>

export const STATEMENT_KINDS: PrintedStatementKind[] = ['profit_and_loss', 'balance_sheet']

export class SourceChoiceError extends Error {}

export async function loadSourceChoices(supabase: ServerClient, clientId: string): Promise<SourceChoice[]> {
  const { data, error } = await supabase
    .from('comparison_source_choices')
    .select('period_key, statement_kind, document_id, chosen_by, chosen_at')
    .eq('client_id', clientId)
    .order('chosen_at', { ascending: true })
  if (error) return []
  return (data ?? []).map((r) => ({
    column: r.period_key,
    statement: r.statement_kind as PrintedStatementKind,
    documentId: r.document_id,
    chosenBy: r.chosen_by,
    chosenAt: r.chosen_at,
  }))
}

/**
 * Checks a choice against the comparison as it is now: the period is shown, and the file prints that
 * statement for it (it is the source or one of the "Also in" files). `documentId` null: back to the rules.
 */
export function checkSourceChoice(comparison: PrintedComparison, column: string, statements: PrintedStatementKind[], documentId: string | null): void {
  const period = comparison.periodSources.find((p) => p.column === column)
  if (!period) throw new SourceChoiceError('That period is not on the comparison any more. Refresh the page.')
  if (documentId === null) return
  for (const kind of statements) {
    const s = period.statements.find((x) => x.statement === kind)
    const prints = s && (s.source?.documentId === documentId || s.alsoIn.some((a) => a.documentId === documentId))
    if (!prints) throw new SourceChoiceError('That file does not print this statement for this period.')
  }
}

export async function saveSourceChoice(
  supabase: ServerClient,
  clientId: string,
  chosenBy: string,
  { column, statements, documentId }: { column: string; statements: PrintedStatementKind[]; documentId: string | null },
): Promise<void> {
  const chosenAt = new Date().toISOString()
  const { error } = await supabase.from('comparison_source_choices').insert(
    statements.map((statement_kind) => ({ client_id: clientId, period_key: column, statement_kind, document_id: documentId, chosen_by: chosenBy, chosen_at: chosenAt })),
  )
  if (error) throw new Error(`Could not keep the choice: ${error.message}`)
}
