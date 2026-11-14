import { z } from 'zod'
import { datedTables, formVersion, handwrittenKeys, tableDateKey } from '@/lib/forms/registry'
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
 * password, and the B1 address. The database refuses them as well (0039,
 * 0054). The dates beside a signature are saved since Nov 2026 (0054).
 */

export interface DraftAnswers {
  fields: Record<string, FieldValue>
  tables: Record<string, TableRow[]>
  signedBy: string | null
  /** The appendix tables' "...and dated", per table page (registry.ts datedTables): each starts from the signature date. */
  signedDates?: Record<string, string | null>
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
  // Each table page's date follows the pre-fill (Form 509's summary date)
  // like any box, unless staff changed it.
  const signedDates: Record<string, string | null> = {}
  for (const id of datedTables(map)) {
    const pre = (prefill.signedDates?.[id]?.value as string | undefined) ?? null
    const saved = draft?.signedDates?.[id] ?? null
    signedDates[id] = saved && (edited.has(tableDateKey(id)) || !pre) ? saved : pre
  }
  return {
    fields,
    tables,
    // The appendix tables' "signed by" is signed by hand: never filled in, and
    // a name a draft kept from before is not brought back.
    signedBy: null,
    signedDates,
    editedKeys: draft?.editedKeys ?? [],
  }
}

/**
 * Part A's Table A7 as saved: the total of its "Amount owing" column, for Form
 * 509's row 6 (Nov 2026). Null when Part A has no A7 row with an amount.
 */
export function savedA7Total(drafts: readonly { form_code: string; subject: string; answers: unknown }[]): number | null {
  const row = drafts.find((d) => d.form_code === '507a' && d.subject === 'company')
  const rows = row ? readDraft(row.answers)?.tables.A7 ?? [] : []
  const amounts = rows
    .map((r) => (typeof r.amount === 'number' ? r.amount : typeof r.amount === 'string' ? Number(r.amount.replace(/[$,\s]/g, '')) : NaN))
    .filter((n) => Number.isFinite(n))
  if (amounts.length === 0) return null
  return Math.round(amounts.reduce((a, b) => a + b, 0) * 100) / 100
}

/** Form 509's "Date to which summary is made up", as saved: the case's signature date (Nov 2026). */
export function savedSummaryDate(drafts: readonly { form_code: string; subject: string; answers: unknown }[]): string | null {
  const row = drafts.find((d) => d.form_code === '509' && d.subject === 'company')
  const value = row ? readDraft(row.answers)?.fields.summary_date : null
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

const Value = z.union([z.string().max(5000), z.number().finite(), z.boolean(), z.null()])

const Body = z.object({
  fields: z.record(z.string().max(80), Value),
  tables: z.record(z.string().max(40), z.array(z.record(z.string().max(40), Value)).max(200)).optional(),
  signedBy: z.string().max(200).nullable().optional(),
  signedDates: z.record(z.string().max(40), z.string().max(40).nullable()).optional(),
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
  // The appendix tables' "signed by" is by hand: never kept. Their "...and
  // dated" is the form's signature date, kept when the form has tables.
  const signedDates: Record<string, string | null> = {}
  for (const id of datedTables(map)) signedDates[id] = parsed.signedDates?.[id]?.trim() || null
  return { fields, tables, signedBy: null, signedDates }
}

/** Staff's changed keys, kept only for the form's own fields and tables. */
export function cleanEditedKeys(code: FormCode, version: string, keys: unknown): string[] {
  if (!Array.isArray(keys)) return []
  const { map } = formVersion(code, version)
  const known = new Set([
    ...map.fields.map((f) => f.key),
    ...map.tables.map((t) => `table:${t.id}`),
    ...datedTables(map).map(tableDateKey),
  ])
  const handwritten = new Set(handwrittenKeys(code, version))
  return [...new Set(keys.filter((k): k is string => typeof k === 'string' && known.has(k) && !handwritten.has(k)))].slice(0, 500)
}

/** A saved draft as the PDF engine takes it (Stage 4). No "signed by": that line is signed by hand. */
export function toFormData(answers: DraftAnswers): FormData {
  const signedDates = Object.fromEntries(Object.entries(answers.signedDates ?? {}).filter((e): e is [string, string] => !!e[1]))
  return { fields: answers.fields, tables: answers.tables, ...(Object.keys(signedDates).length ? { signedDates } : {}) }
}

/** A stored draft read safely; anything unreadable is no draft. */
export function readDraft(value: unknown): DraftAnswers | null {
  const parsed = Body.safeParse(value)
  if (!parsed.success) return null
  return {
    fields: parsed.data.fields,
    tables: (parsed.data.tables ?? {}) as Record<string, TableRow[]>,
    signedBy: null,
    signedDates: parsed.data.signedDates ?? {},
  }
}
