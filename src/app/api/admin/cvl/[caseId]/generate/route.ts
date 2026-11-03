import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { requireStaffUser, staffAuthorName } from '@/lib/auth/staff'
import { FORM_CODES } from '@/lib/forms/registry'
import type { FormCode } from '@/lib/forms/types'
import { loadCaseAccess } from '@/lib/cvl/caseAccess'
import { loadCvlContext } from '@/lib/cvl/context'
import { allFormsSaved, caseJobs, fileNameFor, fillAll, fillJob, loadDraftRows, type FormJob } from '@/lib/cvl/generate'
import { statusUpdate } from '@/lib/cvl/cases'
import type { Json } from '@/types/database'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST /api/admin/cvl/[caseId]/generate — fill and keep the printable forms.
 *
 *   { form: "all" }                       every form of the case in one PDF
 *   { form: "507b", subject: "director:2" }  one form for one subject
 *
 * Each file is filled on the server on top of the official ASIC pages, kept
 * privately in the documents bucket at {client_id}/cvl/{uuid}.pdf, and
 * recorded with the answers it was made from, each form's version, its
 * warnings, who generated it and when. Once every form the case needs has a
 * saved file, a Draft case becomes Forms prepared.
 */

const Body = z.object({ form: z.string(), subject: z.string().optional() })

interface Params {
  params: Promise<{ caseId: string }>
}

const snapshotOf = (jobs: FormJob[]) =>
  jobs.map((j) => ({ form: j.code, subject: j.subject, version: j.version, fromDraft: j.fromDraft, answers: j.answers })) as unknown as Json

export async function POST(req: NextRequest, { params }: Params) {
  const staff = await requireStaffUser()
  if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { caseId } = await params
  const body = Body.safeParse(await req.json().catch(() => null))
  if (!body.success || (body.data.form !== 'all' && !(FORM_CODES as string[]).includes(body.data.form))) {
    return NextResponse.json({ error: 'Unknown form' }, { status: 400 })
  }
  const supabase = getSupabaseServerClient()
  // The file kept so far, removed again if its record cannot be written.
  let stored: string | null = null

  try {
    const access = await loadCaseAccess(supabase, caseId)
    if (!access) return NextResponse.json({ error: 'CVL file not found' }, { status: 404 })
    if (!access.open) return NextResponse.json({ error: 'This file is not an open CVL file.' }, { status: 409 })

    const [ctx, drafts] = await Promise.all([loadCvlContext(supabase, access.clientId), loadDraftRows(supabase, caseId)])
    const all = caseJobs(ctx, drafts)
    const now = new Date()

    let pdf: Uint8Array
    let jobs: FormJob[]
    let warnings: string[]
    let label: string
    let subject: string
    if (body.data.form === 'all') {
      const result = await fillAll(all, `CVL forms — ${access.clientName}`)
      pdf = result.pdf
      jobs = all
      warnings = result.filled.flatMap((f) => f.warnings.map((w) => `${f.job.label}: ${w}`))
      label = `CVL forms ${access.clientName}`
      subject = 'all'
    } else {
      const job = all.find((j) => j.code === (body.data.form as FormCode) && j.subject === (body.data.subject ?? 'company'))
      if (!job) return NextResponse.json({ error: 'This case has no such form' }, { status: 404 })
      const filled = await fillJob(job)
      pdf = filled.fill.pdf
      jobs = [job]
      warnings = filled.warnings
      label = `${job.label} ${access.clientName}`
      subject = job.subject
    }

    stored = `${access.clientId}/cvl/${randomUUID()}.pdf`
    const { error: uploadError } = await supabase.storage.from('documents').upload(stored, pdf, { contentType: 'application/pdf', upsert: false })
    if (uploadError) {
      stored = null
      throw uploadError
    }

    const generatedBy = staffAuthorName(staff)
    const { data: row, error: rowError } = await supabase
      .from('cvl_generated_documents')
      .insert({
        case_id: caseId,
        client_id: access.clientId,
        form_code: body.data.form,
        form_versions: Object.fromEntries(jobs.map((j) => [j.code, j.version])),
        subject,
        file_path: stored,
        answers_snapshot: snapshotOf(jobs),
        warnings: warnings as unknown as Json,
        generated_by: generatedBy,
        generated_at: now.toISOString(),
      })
      .select('id, generated_at')
      .single()
    if (rowError || !row) throw rowError ?? new Error('Insert returned no row')

    // Every form saved: the case is Forms prepared (a Printed case stays Printed).
    let status = access.status
    if (access.status === 'draft') {
      const { data: saved } = await supabase.from('cvl_generated_documents').select('form_code, subject').eq('case_id', caseId)
      if (allFormsSaved(all, saved ?? [])) {
        const update = statusUpdate({ status: 'draft', formsPreparedAt: null, printedAt: null }, 'forms_prepared', now)
        if (update) {
          const { error } = await supabase.from('cvl_cases').update(update).eq('id', caseId)
          if (!error) status = 'forms_prepared'
        }
      }
    }

    return NextResponse.json(
      {
        document: { id: row.id, formCode: body.data.form, subject, fileName: fileNameFor(label, now), warnings, generatedAt: row.generated_at, generatedBy },
        status,
      },
      { status: 201 },
    )
  } catch (err) {
    if (stored) await supabase.storage.from('documents').remove([stored])
    console.error('[POST /api/admin/cvl/[caseId]/generate]', err instanceof Error ? err.message : 'unknown')
    return NextResponse.json({ error: 'Could not generate the forms' }, { status: 500 })
  }
}
