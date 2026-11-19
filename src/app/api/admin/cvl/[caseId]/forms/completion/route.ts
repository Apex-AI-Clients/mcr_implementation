import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { requireStaffUser, staffAuthorName } from '@/lib/auth/staff'
import { FORM_CODES } from '@/lib/forms/registry'
import { isSubject } from '@/lib/cvl/prefill'

/**
 * POST   /api/admin/cvl/[caseId]/forms/completion  { form, subject }  — mark a form complete: it cannot
 *        be edited (its Fill in button is off, saves are refused) until the forms are unlocked
 * DELETE /api/admin/cvl/[caseId]/forms/completion  — "Unlock forms": every form of the case editable again
 *
 * Migration 0063. Who completed it comes from the session.
 */

interface Params {
  params: Promise<{ caseId: string }>
}

const Body = z.object({ form: z.enum(FORM_CODES as [string, ...string[]]), subject: z.string() })

async function openCase(caseId: string) {
  const supabase = getSupabaseServerClient()
  const { data } = await supabase.from('cvl_cases').select('id, removed_at').eq('id', caseId).maybeSingle()
  return { supabase, found: !!data, open: !!data && !data.removed_at }
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const staff = await requireStaffUser()
    if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { caseId } = await params
    const body = Body.safeParse(await req.json().catch(() => null))
    if (!body.success || !isSubject(body.data.subject)) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    if ((body.data.form === '507b') !== body.data.subject.startsWith('director:')) return NextResponse.json({ error: 'Invalid subject for this form' }, { status: 400 })
    const { supabase, found, open } = await openCase(caseId)
    if (!found) return NextResponse.json({ error: 'CVL file not found' }, { status: 404 })
    if (!open) return NextResponse.json({ error: 'This file is not an open CVL file.' }, { status: 409 })
    const { error } = await supabase
      .from('cvl_form_completions')
      .upsert({ case_id: caseId, form_code: body.data.form, subject: body.data.subject, completed_by: staffAuthorName(staff) }, { onConflict: 'case_id,form_code,subject', ignoreDuplicates: true })
    if (error) return NextResponse.json({ error: 'Could not mark it complete: the database is not ready for it yet (migration 0063).' }, { status: 503 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[POST cvl completion]', err instanceof Error ? err.message : 'unknown')
    return NextResponse.json({ error: 'Failed to mark the form complete' }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const staff = await requireStaffUser()
    if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { caseId } = await params
    const { supabase, found, open } = await openCase(caseId)
    if (!found) return NextResponse.json({ error: 'CVL file not found' }, { status: 404 })
    if (!open) return NextResponse.json({ error: 'This file is not an open CVL file.' }, { status: 409 })
    const { error } = await supabase.from('cvl_form_completions').delete().eq('case_id', caseId)
    if (error) return NextResponse.json({ error: 'Could not unlock the forms: the database is not ready for it yet (migration 0063).' }, { status: 503 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[DELETE cvl completion]', err instanceof Error ? err.message : 'unknown')
    return NextResponse.json({ error: 'Failed to unlock the forms' }, { status: 500 })
  }
}
