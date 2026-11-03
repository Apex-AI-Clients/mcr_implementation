import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { sharedPageRedirect } from '@/lib/clients/workspace'
import { loadCaseAccess } from '@/lib/cvl/caseAccess'
import { loadCvlContext } from '@/lib/cvl/context'
import { caseJobs, fillJob, loadDraftRows } from '@/lib/cvl/generate'
import { readCvlStatus } from '@/lib/cvl/cases'
import { CvlStatusControl } from '@/components/cvl/CvlStatusControl'
import { CvlPrintClient } from '@/components/cvl/CvlPrintClient'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface Props {
  params: Promise<{ id: string }>
}

const LABEL: Record<string, string> = { '509': 'Form 509', '507a': 'Form 507 Part A', '507b': 'Form 507 Part B', all: 'All forms' }

/**
 * Preview, print and save for a CVL file: every form it needs (Form 509,
 * Part A, a Part B per director), what to check before printing, and the
 * files already saved. Forms are filled here in memory only to count pages
 * and find what will not fit; nothing is saved until "Save for printing".
 */
export default async function CvlPrintPage({ params }: Props) {
  const { id } = await params
  const supabase = getSupabaseServerClient()
  const { data: client } = await supabase.from('clients').select('id, name, archived_at, workflow').eq('id', id).maybeSingle()
  if (!client) notFound()
  const elsewhere = sharedPageRedirect(client, 'cvl', '/print')
  if (elsewhere) redirect(elsewhere.startsWith('/clients/') ? `/clients/${id}` : elsewhere)

  const { data: caseRow } = await supabase.from('cvl_cases').select('id').eq('client_id', id).maybeSingle()
  if (!caseRow) notFound()
  const access = await loadCaseAccess(supabase, caseRow.id)
  if (!access) notFound()

  const [ctx, drafts, { data: docs }] = await Promise.all([
    loadCvlContext(supabase, id),
    loadDraftRows(supabase, caseRow.id),
    supabase
      .from('cvl_generated_documents')
      .select('id, form_code, subject, form_versions, warnings, generated_by, generated_at')
      .eq('case_id', caseRow.id)
      .order('generated_at', { ascending: false }),
  ])
  const jobs = caseJobs(ctx, drafts)
  const filled = await Promise.all(jobs.map(fillJob))
  const directors = ctx.company?.directors ?? []
  const subjectName = (s: string) => (s.startsWith('director:') ? (directors[Number(s.split(':')[1]) - 1]?.name ?? s) : null)

  return (
    <div className="mx-auto max-w-4xl p-6">
      <Link href={`/cvl/${id}`} className="mb-4 inline-flex items-center gap-1.5 text-xs text-foreground/40 transition-colors hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to the CVL file
      </Link>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-foreground">Preview and print</h1>
        <p className="mt-0.5 text-sm text-foreground/50">{client.name}</p>
      </div>
      <div className="mb-6">
        <CvlStatusControl
          caseId={caseRow.id}
          status={readCvlStatus(access.status)}
          formsPreparedAt={access.formsPreparedAt}
          printedAt={access.printedAt}
        />
      </div>
      <CvlPrintClient
        caseId={caseRow.id}
        clientId={id}
        open={access.open}
        jobs={filled.map((f) => ({
          code: f.job.code,
          subject: f.job.subject,
          label: f.job.label,
          pages: f.fill.pages,
          fromDraft: f.job.fromDraft,
          warnings: f.warnings,
        }))}
        saved={(docs ?? []).map((d) => ({
          id: d.id,
          label: `${LABEL[d.form_code] ?? d.form_code}${subjectName(d.subject) ? ` — ${subjectName(d.subject)}` : ''}`,
          versions: Object.values((d.form_versions ?? {}) as Record<string, string>).join(', '),
          warnings: Array.isArray(d.warnings) ? d.warnings.length : 0,
          generatedAt: d.generated_at,
          generatedBy: d.generated_by,
        }))}
      />
    </div>
  )
}
