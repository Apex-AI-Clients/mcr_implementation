import { notFound, redirect } from 'next/navigation'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { sharedPageRedirect } from '@/lib/clients/workspace'
import { CURRENT_VERSION, FORM_CODES, formVersion } from '@/lib/forms/registry'
import type { FormCode } from '@/lib/forms/types'
import { loadCvlContext } from '@/lib/cvl/context'
import { isSubject, prefillForm, subjectsFor, type Subject } from '@/lib/cvl/prefill'
import { entryState, readDraft, savedA7Total, savedSummaryDate } from '@/lib/cvl/drafts'
import { entryMap } from '@/lib/cvl/entryMap'
import { CvlFormEditor } from '@/components/cvl/CvlFormEditor'
import { isFormCompleted } from '@/lib/cvl/completion'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string; form: string }>
  searchParams: Promise<{ subject?: string }>
}

/**
 * An ASIC form's entry screen for a CVL file: Form 509 and Part A per
 * company, Part B per director (?subject=director:2). Pre-filled from the
 * client file (prefill.ts), with the saved draft over it when there is one.
 */
export default async function CvlFormPage({ params, searchParams }: Props) {
  const { id, form } = await params
  if (!(FORM_CODES as string[]).includes(form)) notFound()
  const code = form as FormCode
  const supabase = getSupabaseServerClient()

  // Everything the page reads, all at once (one after another, each waited a
  // round trip to the database). The drafts of this form for every subject
  // come back together; the one for the subject shown is picked below, once
  // the directors are known.
  const [{ data: client }, { data: cvlCase }, loaded, { subject: asked = '' }, { data: draftRows }, { data: form509 }] = await Promise.all([
    supabase.from('clients').select('id, archived_at, workflow, cvl_cases(removed_at)').eq('id', id).maybeSingle(),
    supabase.from('cvl_cases').select('id').eq('client_id', id).is('removed_at', null).maybeSingle(),
    loadCvlContext(supabase, id),
    searchParams,
    supabase
      .from('cvl_form_answers')
      .select('subject, answers, edited_keys, form_version, updated_by, updated_at, cvl_cases!inner(client_id)')
      .eq('cvl_cases.client_id', id)
      .eq('form_code', code),
    // Form 509's saved summary date (every signature date starts from it) and
    // Part A's saved Table A7 (its total is 509's row 6): Nov 2026.
    supabase
      .from('cvl_form_answers')
      .select('form_code, subject, answers, cvl_cases!inner(client_id)')
      .eq('cvl_cases.client_id', id)
      .in('form_code', ['509', '507a'])
      .eq('subject', 'company'),
  ])
  const ctx = { ...loaded, summaryDate: savedSummaryDate(form509 ?? []), a7Total: savedA7Total(form509 ?? []) }
  if (!client) notFound()
  const elsewhere = sharedPageRedirect(client, 'cvl', `/forms/${code}`)
  // Forms are CVL only: an SBR file opens its client page, not an SBR form page.
  if (elsewhere) redirect(elsewhere.startsWith('/clients/') ? `/clients/${id}` : elsewhere)
  if (!cvlCase) notFound()

  const subjects = subjectsFor(code, { directors: ctx.company?.directors.length ?? 0 })
  const subject: Subject = isSubject(asked) && subjects.includes(asked) ? asked : subjects[0]

  // A form marked complete is not edited until the forms are unlocked (migration 0063): back to the file.
  if (await isFormCompleted(supabase, cvlCase.id, code, subject)) redirect(`/cvl/${id}`)

  const draftRow = (draftRows ?? []).find((r) => r.subject === subject) ?? null
  const draft = draftRow ? readDraft(draftRow.answers) : null

  // A draft written against an older version opens on that version's map.
  const version = draftRow && draft ? draftRow.form_version : CURRENT_VERSION[code]
  const { map } = formVersion(code, version)
  const prefill = prefillForm(code, subject, ctx)
  const initial = entryState(map, prefill, draft ? { ...draft, editedKeys: draftRow?.edited_keys ?? [] } : null)
  const directors = ctx.company?.directors ?? []

  return (
    <CvlFormEditor
      // A reset reloads the page: start again from what the server says.
      key={draftRow?.updated_at ?? 'prefill'}
      caseId={cvlCase.id}
      clientId={id}
      map={entryMap(map)}
      subject={subject}
      subjects={subjects.map((s) => ({
        subject: s,
        label: s === 'company' ? 'Company' : (directors[Number(s.split(':')[1]) - 1]?.name ?? `Director ${s.split(':')[1]}`),
      }))}
      prefill={prefill}
      initial={initial}
      saved={draftRow ? { at: draftRow.updated_at, by: draftRow.updated_by, version: draftRow.form_version } : null}
    />
  )
}
