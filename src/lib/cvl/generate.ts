import type { getSupabaseServerClient } from '@/lib/supabase/server'
import { combinePdfs } from '@/lib/forms/engine'
import { fillOfficialForm } from '@/lib/forms/fill'
import { CURRENT_VERSION, FORM_CODES, formVersion } from '@/lib/forms/registry'
import type { FillResult, FormCode, FormWarning } from '@/lib/forms/types'
import { entryState, readDraft, toFormData, type DraftAnswers } from './drafts'
import { prefillForm, subjectsFor, type Prefill, type Subject } from './prefill'
import type { CvlContext } from './context'
import { cvlFillOptions } from './printPages'

type ServerClient = ReturnType<typeof getSupabaseServerClient>

/**
 * Preview, print and save (Stage 4): every form a case needs, filled on the
 * server on top of the official ASIC pages (src/lib/forms).
 *
 * A form's answers are its saved draft, or — never opened — what the entry
 * screen would open with: the pre-filled answers, the rest blank, every
 * Yes/No "No". Blank boxes print blank, for staff to fill on the entry screen
 * (and preview again) or by hand.
 */

/** One form for one subject, as it will print. */
export interface FormJob {
  code: FormCode
  subject: Subject
  version: string
  answers: DraftAnswers
  /** Whether the answers are a saved draft (else the pre-filled ones). */
  fromDraft: boolean
  /** "Form 509", "Part A", "Part B — Jordan Sample". */
  label: string
  prefill: Prefill
}

export interface DraftRow {
  form_code: string
  subject: string
  form_version: string
  answers: unknown
  edited_keys?: string[] | null
}

const SHORT: Record<FormCode, string> = { '509': 'Form 509', '507a': 'Form 507 Part A', '507b': 'Form 507 Part B' }

/** The forms a case needs, in print order: Form 509, Part A, then one Part B per director. Pure. */
export function caseJobs(ctx: CvlContext, drafts: readonly DraftRow[]): FormJob[] {
  const directors = ctx.company?.directors ?? []
  return FORM_CODES.flatMap((code) =>
    subjectsFor(code, { directors: directors.length }).map((subject) => jobFor(ctx, drafts, code, subject)),
  )
}

export function jobFor(ctx: CvlContext, drafts: readonly DraftRow[], code: FormCode, subject: Subject): FormJob {
  const directors = ctx.company?.directors ?? []
  const row = drafts.find((d) => d.form_code === code && d.subject === subject)
  const draft = row ? readDraft(row.answers) : null
  const version = row && draft ? row.form_version : CURRENT_VERSION[code]
  const prefill = prefillForm(code, subject, ctx)
  const state = entryState(formVersion(code, version).map, prefill, draft ? { ...draft, editedKeys: row?.edited_keys ?? [] } : null)
  const who = subject === 'company' ? '' : ` — ${directors[Number(subject.split(':')[1]) - 1]?.name ?? `Director ${subject.split(':')[1]}`}`
  return {
    code,
    subject,
    version,
    answers: { fields: state.fields, tables: state.tables, signedBy: state.signedBy },
    fromDraft: !!draft,
    label: `${SHORT[code]}${who}`,
    prefill,
  }
}

export interface FilledJob {
  job: FormJob
  fill: FillResult
  /** Everything to look at before printing, worded for staff. */
  warnings: string[]
}

/** What to check before printing: overflow, blank settings, amounts not placed. Pure. */
export function warningsFor(job: FormJob, engine: readonly FormWarning[]): string[] {
  const out = [...job.prefill.warnings.filter((w) => !/^Estimated realisable values/.test(w))]
  for (const w of engine) out.push(`${w.q ? `${w.q}: ` : ''}${w.message}`)
  const unplaced = job.prefill.candidates.filter((c) => !c.target)
  if (unplaced.length) out.push(`Not placed on the form: ${unplaced.map((c) => c.label).join('; ')}.`)
  if (!job.fromDraft) out.push('Never opened: printed from the pre-filled answers.')
  return out
}

/** Fills one form, every page of it: Part A with its page 7 (Form 507A) too. */
export async function fillJob(job: FormJob): Promise<FilledJob> {
  const fill = await fillOfficialForm(job.code, toFormData(job.answers), { version: job.version, ...cvlFillOptions(formVersion(job.code, job.version).map) })
  return { job, fill, warnings: warningsFor(job, fill.warnings) }
}

/** Every form of the case in one PDF ("all forms"), with each form's warnings. */
export async function fillAll(jobs: readonly FormJob[], title: string): Promise<{ pdf: Uint8Array; filled: FilledJob[] }> {
  const filled = await Promise.all(jobs.map(fillJob))
  return { pdf: await combinePdfs(filled.map((f) => f.fill.pdf), title), filled }
}

/** "form-507-part-b-jordan-sample-2026-11-03.pdf": what a saved file downloads as. */
export function fileNameFor(label: string, at: Date = new Date()): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return `${slug}-${at.toISOString().slice(0, 10)}.pdf`
}

/**
 * Whether every form the case needs has a saved generation: an "all forms"
 * file, or one per form and subject. Then the case is Forms prepared. Pure.
 */
export function allFormsSaved(jobs: readonly Pick<FormJob, 'code' | 'subject'>[], saved: readonly { form_code: string; subject: string }[]): boolean {
  if (saved.some((d) => d.form_code === 'all')) return true
  return jobs.every((j) => saved.some((d) => d.form_code === j.code && d.subject === j.subject))
}

export async function loadDraftRows(supabase: ServerClient, caseId: string): Promise<DraftRow[]> {
  const { data } = await supabase.from('cvl_form_answers').select('form_code, subject, form_version, answers, edited_keys').eq('case_id', caseId)
  return data ?? []
}
