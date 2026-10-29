import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { requireStaffUser, staffAuthorName } from '@/lib/auth/staff'
import { CURRENT_VERSION, FORM_CODES } from '@/lib/forms/registry'
import type { FormCode } from '@/lib/forms/types'
import { cleanAnswers, cleanEditedKeys } from '@/lib/cvl/drafts'
import { isSubject } from '@/lib/cvl/prefill'
import type { Json } from '@/types/database'

/**
 * PUT    /api/admin/cvl/[caseId]/forms/[form]  — save a draft of an entry screen
 * DELETE /api/admin/cvl/[caseId]/forms/[form]?subject=…  — back to the pre-filled answers
 *
 * Saved with the form's current version. Only the form's own fields and table
 * columns are kept, and never one written by hand on the printout (drafts.ts;
 * the database refuses them too).
 */

interface Params {
  params: Promise<{ caseId: string; form: string }>
}

const Body = z.object({
  subject: z.string(),
  answers: z.unknown(),
  editedKeys: z.unknown().optional(),
})

async function caseOf(caseId: string) {
  const supabase = getSupabaseServerClient()
  const { data } = await supabase.from('cvl_cases').select('id, client_id, clients(archived_at, workflow)').eq('id', caseId).maybeSingle()
  const client = Array.isArray(data?.clients) ? data?.clients[0] : data?.clients
  return { supabase, row: data, open: !!data && !client?.archived_at && client?.workflow === 'cvl' }
}

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const staff = await requireStaffUser()
    if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { caseId, form } = await params
    if (!(FORM_CODES as string[]).includes(form)) return NextResponse.json({ error: 'Unknown form' }, { status: 404 })
    const code = form as FormCode

    const body = Body.safeParse(await req.json().catch(() => null))
    if (!body.success || !isSubject(body.data.subject)) return NextResponse.json({ error: 'Invalid draft' }, { status: 400 })
    const subject = body.data.subject
    if ((code === '507b') !== subject.startsWith('director:')) return NextResponse.json({ error: 'Invalid subject for this form' }, { status: 400 })

    const version = CURRENT_VERSION[code]
    let answers
    try {
      answers = cleanAnswers(code, version, body.data.answers)
    } catch {
      return NextResponse.json({ error: 'Invalid answers' }, { status: 400 })
    }

    const { supabase, row, open } = await caseOf(caseId)
    if (!row) return NextResponse.json({ error: 'CVL file not found' }, { status: 404 })
    if (!open) return NextResponse.json({ error: 'This file is not an open CVL file.' }, { status: 409 })

    const updatedAt = new Date().toISOString()
    const updatedBy = staffAuthorName(staff)
    const { error } = await supabase.from('cvl_form_answers').upsert(
      {
        case_id: caseId,
        form_code: code,
        form_version: version,
        subject,
        answers: answers as unknown as Json,
        edited_keys: cleanEditedKeys(code, version, body.data.editedKeys),
        updated_by: updatedBy,
        updated_at: updatedAt,
      },
      { onConflict: 'case_id,form_code,subject' },
    )
    if (error) throw error
    return NextResponse.json({ ok: true, formVersion: version, updatedAt, updatedBy })
  } catch (err) {
    console.error('[PUT /api/admin/cvl/[caseId]/forms/[form]]', err instanceof Error ? err.message : 'unknown')
    return NextResponse.json({ error: 'Failed to save the draft' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const staff = await requireStaffUser()
    if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { caseId, form } = await params
    const subject = req.nextUrl.searchParams.get('subject') ?? ''
    if (!(FORM_CODES as string[]).includes(form) || !isSubject(subject)) return NextResponse.json({ error: 'Unknown form' }, { status: 404 })

    const { supabase, row, open } = await caseOf(caseId)
    if (!row) return NextResponse.json({ error: 'CVL file not found' }, { status: 404 })
    if (!open) return NextResponse.json({ error: 'This file is not an open CVL file.' }, { status: 409 })

    const { error } = await supabase.from('cvl_form_answers').delete().eq('case_id', caseId).eq('form_code', form).eq('subject', subject)
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[DELETE /api/admin/cvl/[caseId]/forms/[form]]', err instanceof Error ? err.message : 'unknown')
    return NextResponse.json({ error: 'Failed to reset the draft' }, { status: 500 })
  }
}
