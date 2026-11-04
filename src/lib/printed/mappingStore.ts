import type { getSupabaseServerClient } from '@/lib/supabase/server'
import type { PrintedComparison } from './compare'
import type { MappingEntry } from './mapping'
import { MEANING, MEANINGS, type Meaning } from './meanings'
import { fixSpelling } from './compare'
import { readDirectors } from '@/lib/clients/companyDetails'
import type { RelatedNames } from './dictionary'
import { AUTO_BY, autoMapping, sameChoices, type PossibleLine } from './autoMapping'

/**
 * Server-only. A client's confirmed line mapping (migration 0034): read it,
 * and save staff's confirmation with every change logged. Before the
 * migration is applied there is no mapping: every meaning is "not
 * identified", and saving says so.
 */

type ServerClient = ReturnType<typeof getSupabaseServerClient>

export interface MappingChange {
  meaning: Meaning
  /** auto_*: an auto-selection (autoMapping.ts), changed by 'auto', with the rule used. */
  action: 'added' | 'removed' | 'none_printed' | 'auto_selected' | 'auto_none_printed' | 'auto_removed'
  label: string | null
  changedBy: string
  changedAt: string
  rule: string | null
}

export async function loadMapping(supabase: ServerClient, clientId: string): Promise<MappingEntry[]> {
  // '*': auto_rule (migration 0043) is read when the column is there.
  const { data, error } = await supabase.from('client_line_mappings').select('*').eq('client_id', clientId)
  if (error) return []
  return (data ?? []).map((r) => ({
    meaning: r.meaning as Meaning,
    // Keys saved before a spelling fix (compare.ts fixSpelling) still find their row.
    rowKey: fixSpelling(r.row_key),
    label: r.label,
    nonePrinted: r.none_printed,
    confirmedBy: r.confirmed_by,
    confirmedAt: r.confirmed_at,
    autoRule: (r as { auto_rule?: string | null }).auto_rule ?? null,
  }))
}

export async function loadMappingChanges(supabase: ServerClient, clientId: string): Promise<MappingChange[]> {
  const { data, error } = await supabase
    .from('client_line_mapping_changes')
    .select('*')
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
    rule: (r as { rule?: string | null }).rule ?? null,
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
    // An auto-selection staff replace is not logged as removed: their choice is.
    ...previous.filter((e) => !after.has(id(e)) && !e.autoRule).map((e) => ({ meaning: e.meaning, action: 'removed', row_key: e.rowKey, label: e.label })),
  ]

  const { error: deleteError } = await supabase.from('client_line_mappings').delete().eq('client_id', clientId)
  if (deleteError) throw new Error(`Could not save the mapping: ${deleteError.message}`)
  // auto_rule (migration 0043) only when a kept meaning was auto-selected.
  const anyAuto = next.some((e) => e.autoRule)
  const { error: insertError } = await supabase.from('client_line_mappings').insert(
    next.map((e) => {
      const found = rows.get(e.rowKey)
      return {
        ...mappingRow(clientId, e, found ? { kind: found.kind, path: found.row.path } : null),
        ...(anyAuto ? { auto_rule: e.autoRule ?? null } : {}),
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

function mappingRow(clientId: string, e: MappingEntry, found: { kind: string; path: string[] } | null) {
  return {
    client_id: clientId,
    meaning: e.meaning,
    row_key: e.rowKey,
    statement: found?.kind ?? null,
    label: e.label,
    section_path: found?.path ?? [],
    none_printed: e.nonePrinted,
    // Kept meanings keep who confirmed them, and when.
    confirmed_by: e.confirmedBy,
    confirmed_at: e.confirmedAt,
  }
}

/** The client's directors' names on file (company details), for the loan rule that names a director (dictionary.ts). */
export async function loadDirectorNames(supabase: ServerClient, clientId: string): Promise<string[]> {
  return (await loadRelatedNames(supabase, clientId)).directors as string[]
}

/**
 * The names a related-party loan line can name (dictionary.ts): the
 * directors, and the client, the trust and the company (for a trust, the
 * trustee company) on file.
 */
export async function loadRelatedNames(supabase: ServerClient, clientId: string): Promise<Required<RelatedNames>> {
  const [{ data: details }, { data: client }] = await Promise.all([
    supabase.from('company_details').select('directors, company_name, trust_name').eq('client_id', clientId).maybeSingle(),
    supabase.from('clients').select('name').eq('id', clientId).maybeSingle(),
  ])
  const directors = readDirectors(details?.directors ?? null).map((d) => d.name)
  const parties = [client?.name, details?.company_name, details?.trust_name].filter((n): n is string => !!n && n.trim() !== '')
  return { directors, parties }
}

export interface EffectiveMapping {
  /** Staff choices, then auto-selections for every meaning staff have not confirmed. */
  mapping: MappingEntry[]
  /** Lines that look like a meaning the dictionary did not match: staff decide ("Use it?"). */
  possible: Partial<Record<Meaning, PossibleLine[]>>
}

/**
 * The mapping the pages and the prediction use: staff choices kept as they
 * are, and the auto-selections (autoMapping.ts) worked out from the figures
 * as printed now. When the auto-selections differ from the ones kept (new
 * figures, a reader fix, a staff change), they are replaced and each change
 * is logged as 'auto' with the rule used. Before migration 0043 they cannot be
 * kept: they are still used, and worked out again on every load.
 *
 * Only a comparison with every file read by the current reader decides them:
 * with files still unread (stored reads only, after a reader fix) the kept
 * auto-selections are used as they are, so a half-read comparison never
 * withdraws them.
 */
export async function applyAutoMapping(
  supabase: ServerClient,
  clientId: string,
  loaded: { comparison: PrintedComparison; unread: number },
  stored: MappingEntry[],
  names: RelatedNames,
): Promise<EffectiveMapping> {
  const { comparison } = loaded
  const isAuto = (e: MappingEntry) => e.confirmedBy === AUTO_BY && !!e.autoRule
  const staff = stored.filter((e) => !isAuto(e))
  const kept = stored.filter(isAuto)
  if (loaded.unread > 0) return { mapping: [...staff, ...kept], possible: {} }
  const { entries, possible } = autoMapping(comparison, staff, names)
  if (sameChoices(kept, entries)) return { mapping: [...staff, ...kept], possible }

  const at = new Date().toISOString()
  const fresh = entries.map((e) => ({ ...e, confirmedAt: at }))
  const rows = new Map(comparison.tables.flatMap((t) => t.rows.map((r) => [r.key, { kind: t.kind, path: r.path }] as const)))
  const id = (e: MappingEntry) => `${e.meaning}|${e.rowKey}|${e.nonePrinted}`
  const before = new Set(kept.map(id))
  const after = new Set(fresh.map(id))
  try {
    const gone = kept.filter((e) => !after.has(id(e)))
    for (const e of gone) {
      const { error } = await supabase
        .from('client_line_mappings')
        .delete()
        .eq('client_id', clientId)
        .eq('meaning', e.meaning)
        .eq('row_key', e.rowKey)
        .eq('confirmed_by', AUTO_BY)
      if (error) throw error
    }
    const added = fresh.filter((e) => !before.has(id(e)))
    if (added.length) {
      const { error } = await supabase
        .from('client_line_mappings')
        .upsert(added.map((e) => ({ ...mappingRow(clientId, e, rows.get(e.rowKey) ?? null), auto_rule: e.autoRule ?? null })), {
          onConflict: 'client_id,meaning,row_key',
          ignoreDuplicates: true,
        })
      if (error) throw error
    }
    const log = [
      ...added.map((e) => ({ meaning: e.meaning, action: e.nonePrinted ? 'auto_none_printed' : 'auto_selected', row_key: e.rowKey, label: e.label, rule: e.autoRule ?? null })),
      ...gone.map((e) => ({ meaning: e.meaning, action: 'auto_removed', row_key: e.rowKey, label: e.label, rule: e.autoRule ?? null })),
    ]
    if (log.length) {
      const { error } = await supabase.from('client_line_mapping_changes').insert(log.map((c) => ({ client_id: clientId, ...c, changed_by: AUTO_BY, changed_at: at })))
      if (error) console.error('[line-mapping] could not log the auto-selections:', error.message)
    }
  } catch (err) {
    // Migration 0043 not applied yet (or a write failed): use them, keep nothing.
    console.error('[line-mapping] could not keep the auto-selections:', err instanceof Error ? err.message : err)
  }
  return { mapping: [...staff, ...fresh], possible }
}

/** The names, then the auto-selections over a mapping already loaded beside the comparison. */
export async function withAutoMapping(
  supabase: ServerClient,
  clientId: string,
  loaded: { comparison: PrintedComparison; unread: number },
  stored: MappingEntry[],
): Promise<EffectiveMapping & { names: Required<RelatedNames> }> {
  const names = await loadRelatedNames(supabase, clientId)
  return { ...(await applyAutoMapping(supabase, clientId, loaded, stored, names)), names }
}

