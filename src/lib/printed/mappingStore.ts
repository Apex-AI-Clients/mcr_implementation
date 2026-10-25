import type { getSupabaseServerClient } from '@/lib/supabase/server'
import type { PrintedComparison } from './compare'
import type { MappingEntry } from './mapping'
import { MEANING, MEANINGS, type Meaning } from './meanings'

/**
 * Server-only. A client's confirmed line mapping (migration 0034): read it,
 * and save staff's confirmation with every change logged. Before the
 * migration is applied there is no mapping: every meaning is "not
 * identified", and saving says so.
 */

type ServerClient = ReturnType<typeof getSupabaseServerClient>

export interface MappingChange {
  meaning: Meaning
  action: 'added' | 'removed' | 'none_printed'
  label: string | null
  changedBy: string
  changedAt: string
}

export async function loadMapping(supabase: ServerClient, clientId: string): Promise<MappingEntry[]> {
  const { data, error } = await supabase
    .from('client_line_mappings')
    .select('meaning, row_key, label, none_printed, confirmed_by, confirmed_at')
    .eq('client_id', clientId)
  if (error) return []
  return (data ?? []).map((r) => ({
    meaning: r.meaning as Meaning,
    rowKey: r.row_key,
    label: r.label,
    nonePrinted: r.none_printed,
    confirmedBy: r.confirmed_by,
    confirmedAt: r.confirmed_at,
  }))
}

export async function loadMappingChanges(supabase: ServerClient, clientId: string): Promise<MappingChange[]> {
  const { data, error } = await supabase
    .from('client_line_mapping_changes')
    .select('meaning, action, label, changed_by, changed_at')
    .eq('client_id', clientId)
    .order('changed_at', { ascending: false })
    .limit(200)
  if (error) return []
  return (data ?? []).map((r) => ({
    meaning: r.meaning as Meaning,
    action: r.action as MappingChange['action'],
    label: r.label,
    changedBy: r.changed_by,
    changedAt: r.changed_at,
  }))
}

/** Per meaning: the printed lines chosen, or "none printed". */
export type MappingSelection = Partial<Record<Meaning, { rowKeys: string[] } | { none: true }>>

export class MappingError extends Error {}

/**
 * Saves the meanings staff confirmed (one, several, or "confirm all"), each
 * with who and when; meanings not in the selection keep what they had. Each
 * line must be a row of the comparison, on the right statement; a one-line
 * meaning takes exactly one. What changed is logged.
 */
export async function saveMapping(
  supabase: ServerClient,
  clientId: string,
  by: string,
  selection: MappingSelection,
  comparison: PrintedComparison,
): Promise<MappingEntry[]> {
  const rows = new Map(comparison.tables.flatMap((t) => t.rows.map((r) => [r.key, { row: r, kind: t.kind }] as const)))
  const at = new Date().toISOString()
  const previous = await loadMapping(supabase, clientId)
  const answered = MEANINGS.filter((m) => selection[m.key])
  if (answered.length === 0) throw new MappingError('Nothing to confirm.')
  // Meanings not answered now keep their confirmed lines.
  const next: MappingEntry[] = previous.filter((e) => !selection[e.meaning])
  for (const m of answered) {
    const answer = selection[m.key]!
    if ('none' in answer) {
      next.push({ meaning: m.key, rowKey: '', label: null, nonePrinted: true, confirmedBy: by, confirmedAt: at })
      continue
    }
    if (answer.rowKeys.length === 0) throw new MappingError(`Choose the line for "${m.label}", or say it is not printed.`)
    if (!m.multiple && new Set(answer.rowKeys).size > 1) throw new MappingError(`"${m.label}" is one printed line: choose one.`)
    for (const key of new Set(answer.rowKeys)) {
      const found = rows.get(key)
      if (!found || found.kind !== MEANING[m.key].statement || found.row.style === 'heading') {
        throw new MappingError(`"${m.label}": that line is not on the ${MEANING[m.key].statement === 'profit_and_loss' ? 'profit and loss' : 'balance sheet'}.`)
      }
      next.push({ meaning: m.key, rowKey: key, label: found.row.label || '(no label)', nonePrinted: false, confirmedBy: by, confirmedAt: at })
    }
  }

  const id = (e: MappingEntry) => `${e.meaning}|${e.rowKey}`
  const before = new Set(previous.map(id))
  const after = new Set(next.map(id))
  const changes = [
    ...next.filter((e) => !before.has(id(e))).map((e) => ({ meaning: e.meaning, action: e.nonePrinted ? 'none_printed' : 'added', row_key: e.rowKey, label: e.label })),
    ...previous.filter((e) => !after.has(id(e))).map((e) => ({ meaning: e.meaning, action: 'removed', row_key: e.rowKey, label: e.label })),
  ]

  const { error: deleteError } = await supabase.from('client_line_mappings').delete().eq('client_id', clientId)
  if (deleteError) throw new Error(`Could not save the mapping: ${deleteError.message}`)
  const { error: insertError } = await supabase.from('client_line_mappings').insert(
    next.map((e) => {
      const found = rows.get(e.rowKey)
      return {
        client_id: clientId,
        meaning: e.meaning,
        row_key: e.rowKey,
        statement: found?.kind ?? null,
        label: e.label,
        section_path: found?.row.path ?? [],
        none_printed: e.nonePrinted,
        // Kept meanings keep who confirmed them, and when.
        confirmed_by: e.confirmedBy,
        confirmed_at: e.confirmedAt,
      }
    }),
  )
  if (insertError) throw new Error(`Could not save the mapping: ${insertError.message}`)
  if (changes.length) {
    const { error } = await supabase
      .from('client_line_mapping_changes')
      .insert(changes.map((c) => ({ client_id: clientId, ...c, changed_by: by, changed_at: at })))
    if (error) console.error('[line-mapping] could not log the changes:', error.message)
  }
  return next
}
