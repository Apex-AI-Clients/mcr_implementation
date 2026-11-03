import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { requireStaffUser } from '@/lib/auth/staff'
import { CURRENT_VERSION, FORM_CODES } from '@/lib/forms/registry'
import type { FormCode } from '@/lib/forms/types'
import { loadCaseAccess } from '@/lib/cvl/caseAccess'
import { loadCvlContext } from '@/lib/cvl/context'
import { cleanAnswers } from '@/lib/cvl/drafts'
import { caseJobs, fillAll, fillJob, jobFor, loadDraftRows } from '@/lib/cvl/generate'
import { isSubject, subjectsFor } from '@/lib/cvl/prefill'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * A preview PDF of a CVL form, filled on the server and never saved.
 *
 *   GET  ?form=509&subject=company   the saved draft (or the pre-filled answers)
 *   GET  ?form=all                   every form of the case in one PDF
 *   POST { form, subject, answers }  the answers on screen, not yet saved
 *
 * The things to check before printing come back in the X-Cvl-Warnings header
 * (URI-encoded JSON). Answers sent are cleaned as a draft is: nothing written
 * by hand is ever drawn.
 */

const Body = z.object({ form: z.string(), subject: z.string(), answers: z.unknown() })

function pdfResponse(pdf: Uint8Array, warnings: string[], name: string) {
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${name}"`,
      'Cache-Control': 'no-store',
      'X-Cvl-Warnings': encodeURIComponent(JSON.stringify(warnings)),
    },
  })
}

interface Params {
  params: Promise<{ caseId: string }>
}

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const staff = await requireStaffUser()
    if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { caseId } = await params
    const supabase = getSupabaseServerClient()
    const access = await loadCaseAccess(supabase, caseId)
    if (!access) return NextResponse.json({ error: 'CVL file not found' }, { status: 404 })

    const form = req.nextUrl.searchParams.get('form') ?? ''
    const subject = req.nextUrl.searchParams.get('subject') ?? 'company'
    const [ctx, drafts] = await Promise.all([loadCvlContext(supabase, access.clientId), loadDraftRows(supabase, caseId)])

    if (form === 'all') {
      const { pdf, filled } = await fillAll(caseJobs(ctx, drafts), `CVL forms — ${access.clientName}`)
      return pdfResponse(pdf, filled.flatMap((f) => f.warnings.map((w) => `${f.job.label}: ${w}`)), 'cvl-forms-preview.pdf')
    }
    if (!(FORM_CODES as string[]).includes(form) || !isSubject(subject)) return NextResponse.json({ error: 'Unknown form' }, { status: 404 })
    const code = form as FormCode
    if (!subjectsFor(code, { directors: ctx.company?.directors.length ?? 0 }).includes(subject)) {
      return NextResponse.json({ error: 'Unknown form' }, { status: 404 })
    }
    const filled = await fillJob(jobFor(ctx, drafts, code, subject))
    return pdfResponse(filled.fill.pdf, filled.warnings, `${code}-preview.pdf`)
  } catch (err) {
    console.error('[GET /api/admin/cvl/[caseId]/preview]', err instanceof Error ? err.message : 'unknown')
    return NextResponse.json({ error: 'Could not make the preview' }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const staff = await requireStaffUser()
    if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { caseId } = await params
    const body = Body.safeParse(await req.json().catch(() => null))
    if (!body.success || !(FORM_CODES as string[]).includes(body.data.form) || !isSubject(body.data.subject)) {
      return NextResponse.json({ error: 'Invalid preview' }, { status: 400 })
    }
    const code = body.data.form as FormCode
    let answers
    try {
      answers = cleanAnswers(code, CURRENT_VERSION[code], body.data.answers)
    } catch {
      return NextResponse.json({ error: 'Invalid answers' }, { status: 400 })
    }

    const supabase = getSupabaseServerClient()
    const access = await loadCaseAccess(supabase, caseId)
    if (!access) return NextResponse.json({ error: 'CVL file not found' }, { status: 404 })
    const ctx = await loadCvlContext(supabase, access.clientId)
    // The pre-fill only for its warnings and amounts not placed; the answers are the ones sent.
    const job = { ...jobFor(ctx, [], code, body.data.subject), answers, fromDraft: true, version: CURRENT_VERSION[code] }
    const filled = await fillJob(job)
    return pdfResponse(filled.fill.pdf, filled.warnings, `${code}-preview.pdf`)
  } catch (err) {
    console.error('[POST /api/admin/cvl/[caseId]/preview]', err instanceof Error ? err.message : 'unknown')
    return NextResponse.json({ error: 'Could not make the preview' }, { status: 500 })
  }
}
