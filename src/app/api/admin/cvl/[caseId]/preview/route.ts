import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { requireStaffUser } from '@/lib/auth/staff'
import { CURRENT_VERSION, FORM_CODES, formVersion } from '@/lib/forms/registry'
import type { FormCode } from '@/lib/forms/types'
import { loadCaseAccess } from '@/lib/cvl/caseAccess'
import { loadCvlContext } from '@/lib/cvl/context'
import { cleanAnswers, toFormData } from '@/lib/cvl/drafts'
import { fillOfficialForm } from '@/lib/forms/fill'
import { caseJobs, fillAll, fillJob, jobFor, loadDraftRows } from '@/lib/cvl/generate'
import { isSubject, subjectsFor } from '@/lib/cvl/prefill'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * A preview PDF of a CVL form, filled on the server and never saved.
 *
 *   GET  ?form=509&subject=company   the saved draft (or the pre-filled answers)
 *        …&download=1                the same, saved as a file (the CVL file's Download)
 *   GET  ?form=all                   every form of the case in one PDF
 *   POST { form, subject, answers }  the answers on screen, not yet saved
 *
 * The things to check before printing come back in the X-Cvl-Warnings header
 * (URI-encoded JSON); for one form, X-Cvl-Pages says which template page each
 * output page is (JSON), so the entry screen can show the page being edited. Answers sent are cleaned as a draft is: nothing written
 * by hand is ever drawn.
 */

const Body = z.object({ form: z.string(), subject: z.string(), answers: z.unknown() })

function pdfResponse(pdf: Uint8Array, warnings: string[], name: string, pageSources?: number[], disposition: 'inline' | 'attachment' = 'inline') {
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${disposition}; filename="${name}"`,
      'Cache-Control': 'no-store',
      'X-Cvl-Warnings': encodeURIComponent(JSON.stringify(warnings)),
      ...(pageSources ? { 'X-Cvl-Pages': JSON.stringify(pageSources) } : {}),
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
    if (req.nextUrl.searchParams.get('download') === '1') {
      // Saved as a file, named as the fill-in screen's Download names it.
      const slug = (s: string) => s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase()
      const n = subject.startsWith('director:') ? Number(subject.split(':')[1]) : null
      const who = n ? `-${slug(ctx.company?.directors[n - 1]?.name ?? `director-${n}`)}` : ''
      return pdfResponse(filled.fill.pdf, filled.warnings, `${slug(formVersion(code).map.title)}${who}.pdf`, filled.fill.pageSources, 'attachment')
    }
    return pdfResponse(filled.fill.pdf, filled.warnings, `${code}-preview.pdf`, filled.fill.pageSources)
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
    // Only the answers sent are filled: nothing else on the client file is read
    // (the entry screen shows no warnings, and every request stays light).
    const fill = await fillOfficialForm(code, toFormData(answers))
    return pdfResponse(fill.pdf, fill.warnings.map((w) => `${w.q ? `${w.q}: ` : ''}${w.message}`), `${code}-preview.pdf`, fill.pageSources)
  } catch (err) {
    console.error('[POST /api/admin/cvl/[caseId]/preview]', err instanceof Error ? err.message : 'unknown')
    return NextResponse.json({ error: 'Could not make the preview' }, { status: 500 })
  }
}
