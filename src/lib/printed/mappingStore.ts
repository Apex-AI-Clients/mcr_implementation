import type { getSupabaseServerClient } from '@/lib/supabase/server'
import type { PrintedComparison } from './compare'
import type { MappingEntry } from './mapping'
import { MEANING, MEANINGS, type Meaning } from './meanings'
import { fixSpelling } from './compare'
import { READER_VERSION } from './store'
import { readDirectors } from '@/lib/clients/companyDetails'
import { beneficiaryNames, personAccount, type RelatedNames } from './dictionary'
import { AUTO_BY, autoMapping, sameChoices, type PossibleLine } from './autoMapping'
import { SBR_MEANINGS } from './meanings'
import { decideKeyFigures, gapFigures, type DecisionOutcome, type KeyFigureDecision } from './keyFigureDecision'
import { aiSummariesEnabled } from '@/lib/ai/openrouterClient'
import { chooseKeyFigures, type KeyFigureChoice } from '@/lib/ai/keyFigureChoice'
import type { MaskRecords } from '@/lib/ai/maskLabels'
import { raiseDeveloperAlert } from '@/lib/alerts/developerAlert'
import type { Json } from '@/types/database'

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

/**
 * Lines staff said are not a meaning ("Not a loan account", migration 0062), as `${meaning}|${rowKey}`
 * (mapping.ts, DismissedLines). Empty before 0062 is applied.
 */
export async function loadDismissedLines(supabase: ServerClient, clientId: string): Promise<Set<string>> {
  const { data, error } = await supabase.from('client_line_dismissals').select('meaning, row_key').eq('client_id', clientId)
  if (error) return new Set()
  return new Set((data ?? []).map((d) => `${d.meaning}|${d.row_key}`))
}

/** "Not a loan account": the line is never offered for that meaning again. Throws before 0062 is applied. */
export async function dismissLine(supabase: ServerClient, clientId: string, by: string, line: { meaning: Meaning; rowKey: string; label: string | null }): Promise<void> {
  const { error } = await supabase
    .from('client_line_dismissals')
    .upsert({ client_id: clientId, meaning: line.meaning, row_key: line.rowKey, label: line.label, dismissed_by: by }, { onConflict: 'client_id,meaning,row_key', ignoreDuplicates: true })
  if (error) throw new MappingError('Could not record the answer: the database is not ready for it yet (migration 0062).')
  await supabase.from('client_line_mapping_changes').insert({ client_id: clientId, meaning: line.meaning, action: 'removed', row_key: line.rowKey, label: line.label, changed_by: by, rule: 'Not a loan account (a possible line staff turned down)' })
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
    updatedNote: (r as { updated_note?: string | null }).updated_note ?? null,
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
        ...(next.some((x) => x.updatedNote) ? { updated_note: e.updatedNote ?? null } : {}),
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
  await storeStaffDecisions(supabase, clientId, by, next, answered.map((m) => m.key), comparison)
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
/** The balance sheet totals on the comparison page (migration 0061). */
const TOTAL_MEANINGS: ReadonlySet<string> = new Set(['total_current_assets', 'total_non_current_assets', 'total_assets'])

export async function applyAutoMapping(
  supabase: ServerClient,
  clientId: string,
  loaded: { comparison: PrintedComparison; unread: number },
  stored: MappingEntry[],
  names: RelatedNames,
): Promise<EffectiveMapping> {
  const isAuto = (e: MappingEntry) => e.confirmedBy === AUTO_BY && !!e.autoRule
  if (loaded.unread > 0) return { mapping: [...stored.filter((e) => !isAuto(e)), ...stored.filter(isAuto)], possible: {} }
  // Stored decisions (migration 0067): each key figure decided once per set of documents.
  const decisions = await loadDecisions(supabase, clientId)
  if (decisions !== null) return applyDecisions(supabase, clientId, loaded.comparison, stored, names, decisions)
  return legacyAutoMapping(supabase, clientId, loaded, stored, names)
}

/** Before migration 0067: the auto-selections worked out again on every load (as before 26 Nov 2026). */
async function legacyAutoMapping(
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
  const { entries, possible, replaced } = autoMapping(comparison, staff, names, { staleBefore: await readerReleasedAt(supabase) })
  if (replaced.length === 0 && sameChoices(kept, entries)) return { mapping: [...staff, ...kept], possible }
  const staffKept = staff.filter((e) => !replaced.includes(e))

  const at = new Date().toISOString()
  const fresh = entries.map((e) => ({ ...e, confirmedAt: at }))
  const rows = new Map(comparison.tables.flatMap((t) => t.rows.map((r) => [r.key, { kind: t.kind, path: r.path }] as const)))
  const id = (e: MappingEntry) => `${e.meaning}|${e.rowKey}|${e.nonePrinted}`
  const before = new Set(kept.map(id))
  const after = new Set(fresh.map(id))
  try {
    // Staff answers given under an older reader, switched to the lines matched now.
    for (const e of replaced) {
      const { error } = await supabase.from('client_line_mappings').delete().eq('client_id', clientId).eq('meaning', e.meaning).eq('row_key', e.rowKey)
      if (error) throw error
    }
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
    const allAdded = fresh.filter((e) => !before.has(id(e)))
    // The balance sheet totals (migration 0061) are kept on their own: before 0061 is applied the
    // database refuses them, and that must never stop the other meanings being kept.
    const totals = allAdded.filter((e) => TOTAL_MEANINGS.has(e.meaning))
    if (totals.length) {
      const { error } = await supabase
        .from('client_line_mappings')
        .upsert(
          totals.map((e) => ({ ...mappingRow(clientId, e, rows.get(e.rowKey) ?? null), auto_rule: e.autoRule ?? null })),
          { onConflict: 'client_id,meaning,row_key', ignoreDuplicates: true },
        )
      if (error) console.error('[line-mapping] could not keep the balance sheet totals (migration 0061):', error.message)
    }
    const added = allAdded.filter((e) => !TOTAL_MEANINGS.has(e.meaning))
    if (added.length) {
      const { error } = await supabase
        .from('client_line_mappings')
        .upsert(
          added.map((e) => ({
            ...mappingRow(clientId, e, rows.get(e.rowKey) ?? null),
            auto_rule: e.autoRule ?? null,
            // updated_note (migration 0044) only on a switched answer.
            ...(e.updatedNote ? { updated_note: e.updatedNote } : {}),
          })),
          {
            onConflict: 'client_id,meaning,row_key',
            ignoreDuplicates: true,
          },
        )
      if (error) throw error
    }
    const log = [
      ...replaced.map((e) => ({ meaning: e.meaning, action: 'auto_removed', row_key: e.rowKey, label: e.label, rule: `Staff answer replaced after a reading fix (was: Not printed, by ${e.confirmedBy})` })),
      ...added.map((e) => ({ meaning: e.meaning, action: e.nonePrinted ? 'auto_none_printed' : 'auto_selected', row_key: e.rowKey, label: e.label, rule: e.updatedNote ? `${e.updatedNote}. ${e.autoRule ?? ''}` : (e.autoRule ?? null) })),
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
  return { mapping: [...staffKept, ...fresh], possible }
}

/**
 * When the current READER_VERSION first ran on this deployment (reader_releases,
 * migration 0044): staff answers given before it were given under an older
 * reader. Null (no switching) when the table is not there yet.
 */
export async function readerReleasedAt(supabase: ServerClient): Promise<string | null> {
  const read = async () => {
    const { data, error } = await supabase.from('reader_releases').select('first_seen_at').eq('version', READER_VERSION).maybeSingle()
    return error ? undefined : (data?.first_seen_at ?? null)
  }
  const seen = await read()
  if (seen !== null) return seen ?? null
  const { error } = await supabase.from('reader_releases').upsert({ version: READER_VERSION }, { onConflict: 'version', ignoreDuplicates: true })
  if (error) return null
  return (await read()) ?? null
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

// ── Stored key-figure decisions (migration 0067; item 9b/9c, the user's conditions, 26 Nov 2026) ──

export interface StoredDecision {
  meaning: Meaning
  outcome: DecisionOutcome
  chosenBy: 'ai' | 'rule' | 'staff'
  decidedBy: string
  decidedAt: string
  rule: string | null
  aiReason: string | null
  rowKeys: string[]
  possible: PossibleLine[]
  documentIds: string[]
}

/** The client's stored decisions; null before migration 0067 is applied. */
export async function loadDecisions(supabase: ServerClient, clientId: string): Promise<Map<Meaning, StoredDecision> | null> {
  let result
  try {
    result = await supabase.from('key_figure_decisions').select('*').eq('client_id', clientId)
  } catch {
    return null
  }
  const { data, error } = result
  if (error) return null
  return new Map(
    (data ?? []).map((r) => [
      r.meaning as Meaning,
      {
        meaning: r.meaning as Meaning,
        outcome: r.outcome as DecisionOutcome,
        chosenBy: r.chosen_by as StoredDecision['chosenBy'],
        decidedBy: r.decided_by,
        decidedAt: r.decided_at,
        rule: r.rule,
        aiReason: r.ai_reason,
        rowKeys: (r.row_keys ?? []).map(fixSpelling),
        possible: Array.isArray(r.possible) ? (r.possible as unknown as PossibleLine[]) : [],
        documentIds: [...(r.document_ids ?? [])].sort(),
      },
    ]),
  )
}

/** The files the comparison's figures come from: a different set re-opens a decision. */
export function comparisonDocumentIds(comparison: PrintedComparison): string[] {
  const ids = new Set<string>()
  for (const t of comparison.tables) for (const r of t.rows) for (const c of r.cells) if (c.printed && c.source) ids.add(c.source.documentId)
  return [...ids].sort()
}

/** Why a stored decision is open again; null while it stands. */
export function reopenReason(d: StoredDecision | undefined, documentIds: string[], rowKeys: Set<string>): string | null {
  if (!d) return 'not decided yet'
  if (d.chosenBy === 'staff') return 'staff cleared their choice'
  if (d.documentIds.length !== documentIds.length || d.documentIds.some((id, i) => id !== documentIds[i])) return 'the documents changed'
  if (d.outcome === 'lines' && (d.rowKeys.length === 0 || d.rowKeys.some((k) => !rowKeys.has(k)))) return 'a chosen line is no longer printed'
  return null
}

/** The names Claude sees masked, by role (maskLabels.ts): read only when Claude is asked. */
export async function loadMaskRecords(supabase: ServerClient, clientId: string, comparison: PrintedComparison): Promise<MaskRecords> {
  const [{ data: details }, { data: client }] = await Promise.all([
    supabase.from('company_details').select('directors, company_name, trust_name').eq('client_id', clientId).maybeSingle(),
    supabase.from('clients').select('name').eq('id', clientId).maybeSingle(),
  ])
  const labels = (comparison.tables.find((t) => t.kind === 'balance_sheet')?.rows ?? []).map((r) => r.label)
  const shares = labels.flatMap((l) => {
    const p = personAccount(l)
    return p && /^share of/i.test(p.kind) ? [p.name] : []
  })
  const trust = details?.trust_name?.trim() || null
  const company = details?.company_name?.trim() || null
  return {
    client: [client?.name ?? '', trust ?? '', trust ? '' : (company ?? '')],
    directors: readDirectors(details?.directors ?? null).map((d) => d.name),
    // A trust client's company is its trustee: a related company.
    relatedCompanies: trust && company ? [company] : [],
    beneficiaries: [...beneficiaryNames(labels), ...shares],
  }
}

function decisionEntries(d: StoredDecision, comparison: PrintedComparison): MappingEntry[] {
  const rows = new Map(comparison.tables.flatMap((t) => t.rows.map((r) => [r.key, r] as const)))
  const autoRule = d.rule ?? (d.chosenBy === 'ai' ? `Chosen by AI: ${d.aiReason ?? ''}` : 'Chosen by the rules.')
  if (d.outcome === 'not_printed') return [{ meaning: d.meaning, rowKey: '', label: null, nonePrinted: true, confirmedBy: AUTO_BY, confirmedAt: d.decidedAt, autoRule }]
  if (d.outcome !== 'lines') return []
  return d.rowKeys.map((k) => ({ meaning: d.meaning, rowKey: k, label: rows.get(k)?.label || '(no label)', nonePrinted: false, confirmedBy: AUTO_BY, confirmedAt: d.decidedAt, autoRule }))
}

/**
 * Decided once: staff choices as they are; a stored decision stands until the
 * documents change, a chosen line is no longer printed, or staff clear their
 * choice. Only the meanings open are decided (Claude with the rules on top,
 * or the rules alone), stored, and logged. Never on a page load or a release
 * otherwise.
 */
async function applyDecisions(
  supabase: ServerClient,
  clientId: string,
  comparison: PrintedComparison,
  stored: MappingEntry[],
  names: RelatedNames,
  decisions: Map<Meaning, StoredDecision>,
): Promise<EffectiveMapping> {
  const isAuto = (e: MappingEntry) => e.confirmedBy === AUTO_BY && !!e.autoRule
  const staff = stored.filter((e) => !isAuto(e))
  const kept = stored.filter(isAuto)
  const documentIds = comparisonDocumentIds(comparison)
  const rowKeys = new Set(comparison.tables.flatMap((t) => t.rows.filter((r) => r.style !== 'heading').map((r) => r.key)))
  const staffMeanings = new Set(staff.map((e) => e.meaning))
  // Staff answers' notes ("now matched…") and every meaning's rule reading, on the figures as printed now.
  // No staff answer is switched on a release (staleBefore null): a release never re-decides.
  const rules = autoMapping(comparison, staff, names, { staleBefore: null })
  const possible: EffectiveMapping['possible'] = {}
  for (const m of staffMeanings) if (rules.possible[m]) possible[m] = rules.possible[m]

  const open: Meaning[] = []
  const standing: StoredDecision[] = []
  for (const { key: m } of SBR_MEANINGS) {
    if (staffMeanings.has(m)) continue
    const d = decisions.get(m)
    if (reopenReason(d, documentIds, rowKeys) === null) standing.push(d!)
    else open.push(m)
  }
  const mapping: MappingEntry[] = [...staff]
  for (const d of standing) {
    mapping.push(...decisionEntries(d, comparison))
    const lines = d.possible.filter((p) => rowKeys.has(p.rowKey))
    if (lines.length) possible[d.meaning] = lines
  }
  if (open.length === 0) return { mapping, possible }

  // Claude, when the AI is on; the rules alone when it is off or fails (failures to the developer alert only).
  let choice: KeyFigureChoice | null = null
  // Only the figures the rules left as a gap go to the AI (the user, 26 Nov 2026): never one the rules chose.
  const gaps = gapFigures(open, rules)
  if (aiSummariesEnabled() && gaps.length > 0) {
    try {
      choice = await chooseKeyFigures(comparison, await loadMaskRecords(supabase, clientId, comparison), gaps)
    } catch (err) {
      await raiseDeveloperAlert(supabase, {
        kind: 'key_figure_ai',
        key: `key_figure_ai:${clientId}:${documentIds.join(',').slice(0, 300)}`,
        subject: 'Key figures: the AI choice failed, the rules decided alone',
        lines: [`Client id: ${clientId}`, `Key figures open: ${open.length}`, `Error: ${err instanceof Error ? err.name : 'unknown'}`],
        details: { client_id: clientId, open: open.length, error: err instanceof Error ? err.name : 'unknown' },
      })
    }
  }
  const decided = decideKeyFigures(comparison, open, rules, names, choice)
  const at = new Date().toISOString()

  const fresh: { decision: KeyFigureDecision; entries: MappingEntry[] }[] = []
  for (const d of decided) {
    const previous = decisions.get(d.meaning)
    const row = {
      client_id: clientId,
      meaning: d.meaning,
      outcome: d.outcome,
      chosen_by: d.chosenBy,
      decided_by: AUTO_BY,
      decided_at: at,
      rule: d.rule,
      ai_reason: d.aiReason,
      row_keys: d.outcome === 'lines' ? d.entries.filter((e) => !e.nonePrinted).map((e) => e.rowKey) : [],
      possible: d.possible as unknown as Json,
      document_ids: documentIds,
    }
    // Claimed once: a first decision is inserted only if none is there; a re-opened one replaced only
    // if it is still the one read. Another request that got there first wins, and its decision is used.
    const claim = previous
      ? await supabase.from('key_figure_decisions').update(row).eq('client_id', clientId).eq('meaning', d.meaning).eq('decided_at', previous.decidedAt).select('meaning')
      : await supabase.from('key_figure_decisions').upsert(row, { onConflict: 'client_id,meaning', ignoreDuplicates: true }).select('meaning')
    if (claim.error || !claim.data?.length) {
      const now = (await loadDecisions(supabase, clientId))?.get(d.meaning)
      if (now && reopenReason(now, documentIds, rowKeys) === null) {
        mapping.push(...decisionEntries(now, comparison))
        const lines = now.possible.filter((p) => rowKeys.has(p.rowKey))
        if (lines.length) possible[d.meaning] = lines
        continue
      }
    }
    const entries = d.entries.map((e) => ({ ...e, confirmedAt: at }))
    mapping.push(...entries)
    if (d.possible.length) possible[d.meaning] = d.possible
    fresh.push({ decision: d, entries })
  }
  await copyDecisionsToMapping(supabase, clientId, comparison, kept, fresh, at)
  return { mapping, possible }
}

/** The decided meanings' auto lines, copied to client_line_mappings (as before 0067) and logged. */
async function copyDecisionsToMapping(
  supabase: ServerClient,
  clientId: string,
  comparison: PrintedComparison,
  kept: MappingEntry[],
  fresh: { decision: KeyFigureDecision; entries: MappingEntry[] }[],
  at: string,
): Promise<void> {
  if (fresh.length === 0) return
  const rows = new Map(comparison.tables.flatMap((t) => t.rows.map((r) => [r.key, { kind: t.kind, path: r.path }] as const)))
  const id = (e: MappingEntry) => `${e.meaning}|${e.rowKey}|${e.nonePrinted}`
  const log: { meaning: Meaning; action: string; row_key: string; label: string | null; rule: string | null }[] = []
  try {
    for (const { decision, entries } of fresh) {
      const before = kept.filter((e) => e.meaning === decision.meaning)
      const beforeIds = new Set(before.map(id))
      const after = new Set(entries.map(id))
      const gone = before.filter((e) => !after.has(id(e)))
      const added = entries.filter((e) => !beforeIds.has(id(e)))
      if (gone.length) {
        const { error } = await supabase.from('client_line_mappings').delete().eq('client_id', clientId).eq('meaning', decision.meaning).eq('confirmed_by', AUTO_BY)
        if (error) throw error
      }
      // All of them again after a delete (it took the meaning's auto lines); else only the new ones.
      const write = gone.length ? entries : added
      if (write.length) {
        const { error } = await supabase
          .from('client_line_mappings')
          .upsert(write.map((e) => ({ ...mappingRow(clientId, e, rows.get(e.rowKey) ?? null), auto_rule: e.autoRule ?? null })), { onConflict: 'client_id,meaning,row_key', ignoreDuplicates: true })
        // The balance sheet totals before migration 0061: the decision still holds them.
        if (error && !TOTAL_MEANINGS.has(decision.meaning)) throw error
      }
      log.push(
        ...added.map((e) => ({ meaning: e.meaning, action: e.nonePrinted ? 'auto_none_printed' : 'auto_selected', row_key: e.rowKey, label: e.label, rule: decision.rule })),
        ...gone.map((e) => ({
          meaning: e.meaning,
          action: 'auto_removed',
          row_key: e.rowKey,
          label: e.label,
          rule: decision.outcome === 'possible' ? `Waits for staff: ${decision.possible.length} possible line(s)${decision.aiReason ? `. AI: ${decision.aiReason}` : ''}` : decision.rule,
        })),
      )
    }
    if (log.length) {
      const { error } = await supabase.from('client_line_mapping_changes').insert(log.map((c) => ({ client_id: clientId, ...c, changed_by: AUTO_BY, changed_at: at })))
      if (error) console.error('[line-mapping] could not log the decisions:', error.message)
    }
  } catch (err) {
    // The decisions are stored (0067): the copy is for the history only.
    console.error('[line-mapping] could not copy the decisions:', err instanceof Error ? err.message : err)
  }
}

/** Staff's answers, stored as their decisions (who, when): a staff answer is never re-decided. */
export async function storeStaffDecisions(
  supabase: ServerClient,
  clientId: string,
  by: string,
  saved: MappingEntry[],
  meanings: Meaning[],
  comparison: PrintedComparison,
): Promise<void> {
  if (meanings.length === 0) return
  const documentIds = comparisonDocumentIds(comparison)
  const rows = meanings.map((m) => {
    const mine = saved.filter((e) => e.meaning === m)
    const none = mine.some((e) => e.nonePrinted)
    return {
      client_id: clientId,
      meaning: m,
      outcome: none ? 'not_printed' : 'lines',
      chosen_by: 'staff',
      decided_by: by,
      decided_at: mine[0]?.confirmedAt || new Date().toISOString(),
      rule: null,
      ai_reason: null,
      row_keys: none ? [] : mine.map((e) => e.rowKey),
      possible: [] as unknown as Json,
      document_ids: documentIds,
    }
  })
  try {
    const { error } = await supabase.from('key_figure_decisions').upsert(rows, { onConflict: 'client_id,meaning' })
    // Before migration 0067: the staff answer is in client_line_mappings as always.
    if (error) console.error('[line-mapping] could not store the staff decisions:', error.message)
  } catch (err) {
    console.error('[line-mapping] could not store the staff decisions:', err instanceof Error ? err.message : err)
  }
}
