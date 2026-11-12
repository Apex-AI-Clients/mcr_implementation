import { z } from 'zod'
import { formVersion, handwrittenKeys } from '@/lib/forms/registry'
import type { FieldValue, FormCode, FormData, FormMap, TableRow } from '@/lib/forms/types'
import type { Prefill } from './prefill'

/**
 * The entry screens' drafts (cvl_form_answers, migration 0039). Pure.
 *
 * A draft holds every answer as staff left it, with the form version it was
 * written against, and which answers staff changed from the pre-filled ones
 * (so the ⓘ is shown only on a value that is still the pre-filled one).
 *
 * What is written by hand on the printout is never saved: B6 user name and
 * password, the B1 address, and every date beside a signature. The database
 * refuses them as well (0039).
 */

export interface DraftAnswers {
  fields: Record<string, FieldValue>
  tables: Record<string, TableRow[]>
  signedBy: string | null
}

export interface EntryState extends DraftAnswers {
  editedKeys: string[]
}

const isBlank = (v: FieldValue) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '')

/** The answers a screen opens with: the draft's, else the pre-filled ones, else blank — and every Yes/No "No". */
export function entryState(map: FormMap, prefill: Prefill, draft: (DraftAnswers & { editedKeys?: string[] }) | null): EntryState {
  // A saved draft keeps what was typed (its edited keys). A box never typed
  // in follows the pre-fill as it is now, so a later change on the client
  // file or in the CVL settings reaches a form already saved; a box the
  // pre-fill has nothing for keeps what the draft holds.
  const edited = new Set(draft?.editedKeys ?? [])
  const fields: Record<string, FieldValue> = {}
  for (const f of map.fields) {
    if (f.handwritten) continue
    const pre = prefill.fields[f.key]
    if (draft && f.key in draft.fields && (edited.has(f.key) || !pre)) fields[f.key] = draft.fields[f.key]
    else if (pre) fields[f.key] = pre.value
    else fields[f.key] = f.type === 'yesno' ? 'no' : null
    if (f.type === 'yesno' && isBlank(fields[f.key])) fields[f.key] = 'no'
  }
  const tables: Record<string, TableRow[]> = {}
  for (const t of map.tables) {
    const saved = draft?.tables[t.id]
    const pre = prefill.tables[t.id]
    tables[t.id] = saved && (edited.has(`table:${t.id}`) || !pre?.length) ? saved : (pre ?? []).map((r) => r.row)
  }
  const preSigned = (prefill.signedBy?.value as string | undefined) ?? null
  return {
    fields,
    tables,
    // Only a name staff typed is kept: one a draft saved from an earlier
    // pre-fill (Part A's tables, before they were left for the client) is not.
    signedBy: draft && edited.has('signedBy') ? draft.signedBy : preSigned,
    editedKeys: draft?.editedKeys ?? [],
  }
}

const Value = z.union([z.string().max(5000), z.number().finite(), z.boolean(), z.null()])

const Body = z.object({
  fields: z.record(z.string().max(80), Value),
  tables: z.record(z.string().max(40), z.array(z.record(z.string().max(40), Value)).max(200)).optional(),
  signedBy: z.string().max(200).nullable().optional(),
})

/**
 * Answers sent to be saved → what is kept: only the form's own fields and
 * table columns, never a handwritten one, rows with nothing in them dropped.
 * Throws on a body that is not answers at all.
 */
export function cleanAnswers(code: FormCode, version: string, input: unknown): DraftAnswers {
  const parsed = Body.parse(input)
  const { map } = formVersion(code, version)
  const handwritten = new Set(handwrittenKeys(code, version))
  const known = new Set(map.fields.filter((f) => !handwritten.has(f.key)).map((f) => f.key))

  const fields: Record<string, FieldValue> = {}
  for (const [k, v] of Object.entries(parsed.fields)) if (known.has(k)) fields[k] = v

  const tables: Record<string, TableRow[]> = {}
  for (const t of map.tables) {
    const columns = new Set(t.columns.map((c) => c.key))
    const rows = (parsed.tables?.[t.id] ?? [])
      .map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => columns.has(k))) as TableRow)
      .filter((r) => Object.values(r).some((v) => !isBlank(v) && v !== false))
    if (rows.length) tables[t.id] = rows
  }
  // The appendix tables' "...and dated" (signedDate) is not in the schema: never kept.
  return { fields, tables, signedBy: parsed.signedBy?.trim() || null }
}

/** Staff's changed keys, kept only for the form's own fields and tables. */
export function cleanEditedKeys(code: FormCode, version: string, keys: unknown): string[] {
  if (!Array.isArray(keys)) return []
  const { map } = formVersion(code, version)
  const known = new Set([...map.fields.map((f) => f.key), ...map.tables.map((t) => `table:${t.id}`), 'signedBy'])
  const handwritten = new Set(handwrittenKeys(code, version))
  return [...new Set(keys.filter((k): k is string => typeof k === 'string' && known.has(k) && !handwritten.has(k)))].slice(0, 500)
}

/** A saved draft as the PDF engine takes it (Stage 4). */
export function toFormData(answers: DraftAnswers): FormData {
  return { fields: answers.fields, tables: answers.tables, ...(answers.signedBy ? { signedBy: answers.signedBy } : {}) }
}

/** A stored draft read safely; anything unreadable is no draft. */
export function readDraft(value: unknown): DraftAnswers | null {
  const parsed = Body.safeParse(value)
  if (!parsed.success) return null
  return { fields: parsed.data.fields, tables: (parsed.data.tables ?? {}) as Record<string, TableRow[]>, signedBy: parsed.data.signedBy ?? null }
}
