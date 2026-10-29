import { notFound, redirect } from 'next/navigation'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { sharedPageRedirect } from '@/lib/clients/workspace'
import { CURRENT_VERSION, FORM_CODES, formVersion } from '@/lib/forms/registry'
import type { FormCode } from '@/lib/forms/types'
import { loadCvlContext } from '@/lib/cvl/context'
import { isSubject, prefillForm, subjectsFor, type Subject } from '@/lib/cvl/prefill'
import { entryState, readDraft } from '@/lib/cvl/drafts'
import { entryMap } from '@/lib/cvl/entryMap'
import { CvlFormEditor } from '@/components/cvl/CvlFormEditor'

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

  const { data: client } = await supabase.from('clients').select('id, archived_at, workflow').eq('id', id).maybeSingle()
  if (!client) notFound()
  const elsewhere = sharedPageRedirect(client, 'cvl', `/forms/${code}`)
  // Forms are CVL only: an SBR file opens its client page, not an SBR form page.
  if (elsewhere) redirect(elsewhere.startsWith('/clients/') ? `/clients/${id}` : elsewhere)

  const { data: cvlCase } = await supabase.from('cvl_cases').select('id').eq('client_id', id).maybeSingle()
  if (!cvlCase) notFound()

  const ctx = await loadCvlContext(supabase, id)
  const subjects = subjectsFor(code, { directors: ctx.company?.directors.length ?? 0, perDirector: ctx.settings.perDirector })
  const asked = (await searchParams).subject ?? ''
  const subject: Subject = isSubject(asked) && subjects.includes(asked) ? asked : subjects[0]

  const { data: draftRow } = await supabase
    .from('cvl_form_answers')
    .select('answers, edited_keys, form_version, updated_by, updated_at')
    .eq('case_id', cvlCase.id)
    .eq('form_code', code)
    .eq('subject', subject)
    .maybeSingle()
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
