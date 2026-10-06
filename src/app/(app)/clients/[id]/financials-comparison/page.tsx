import { notFound, redirect } from 'next/navigation'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { ComparisonClient } from './ComparisonClient'
import { buildCoverage } from '@/lib/financials/coverage'
import { financialsDiagnosticsEnabled } from '@/lib/financials/diagnostics'
import { closeDeadJob, isJobDead } from '@/lib/financials/jobLiveness'
import { loadColumnFailures, loadStoredSlots } from '@/lib/financials/storedStatements'
import type { StoredStatementSlot } from '@/lib/financials/types'
import type { FinancialsComparison } from '@/lib/financials/types'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
}

export default async function FinancialsComparisonPage({ params }: Props) {
  const { id } = await params
  const supabase = getSupabaseServerClient()

  const { data: client } = await supabase
    .from('clients')
    .select('id, name, archived_at')
    .eq('id', id)
    .maybeSingle()
  if (!client) notFound()
  // An archived file is viewed, read-only, in the Archive.
  if (client.archived_at) redirect(`/sbr/archive/${client.id}`)

  const [
    { data: documents },
    { data: statements },
    { data: recorded },
    { data: comparisonRow },
    { data: activeJob },
    slots,
    failures,
  ] = await Promise.all([
    supabase
      .from('documents')
      .select('id')
      .eq('client_id', id)
      .in('doc_category', ['historical_financials', 'current_financials']),
    supabase
      .from('financial_statements')
      .select('id, document_id, is_document_id, bs_document_id')
      .eq('client_id', id),
    // Documents the pre-pass has seen, including ones that stored nothing
    // (a trust deed in a financials slot) — they are not "unextracted".
    supabase.from('financial_document_extractions').select('document_id').eq('client_id', id),
    supabase
      .from('financial_comparisons')
      .select('*')
      .eq('client_id', id)
      .maybeSingle(),
    // If a comparison job is mid-flight (e.g. the user refreshed during a run),
    // hand its id to the client so polling resumes seamlessly.
    supabase
      .from('financial_comparison_jobs')
      .select('id, status, created_at')
      .eq('client_id', id)
      .in('status', ['pending', 'processing'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    // For the coverage table. A failed read shows no table rather than an error.
    loadStoredSlots(supabase, id).catch(() => [] as StoredStatementSlot[]),
    loadColumnFailures(supabase, id),
  ])

  // A job that outlived its function is dead: close it rather than resume it.
  const liveJob = activeJob && isJobDead(activeJob) ? null : activeJob
  if (activeJob && !liveJob) await closeDeadJob(supabase, activeJob.id)

  const documentCount = documents?.length ?? 0
  // A document counts as extracted once it owns a half (a single PDF can fill
  // several slots), or once the pre-pass has recorded it. Rows written before
  // per-half owners existed still name their document in document_id.
  const extractedDocIds = new Set<string | null>([
    ...(statements ?? []).flatMap((s) =>
      s.is_document_id || s.bs_document_id ? [s.is_document_id, s.bs_document_id] : [s.document_id],
    ),
    ...(recorded ?? []).map((r) => r.document_id),
  ])
  const documentIds = new Set((documents ?? []).map((d) => d.id))
  // Documents, not statement rows: one PDF fills several rows.
  const extractedCount = [...documentIds].filter((d) => extractedDocIds.has(d)).length
  const hasUnextracted = extractedCount < documentIds.size

  const comparison: FinancialsComparison | null = comparisonRow
    ? (comparisonRow.computed as unknown as FinancialsComparison)
    : null

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <ComparisonClient
        clientId={id}
        clientName={client.name}
        initialComparison={comparison}
        initialAiSummary={comparisonRow?.ai_summary ?? null}
        initialGeneratedAt={comparisonRow?.generated_at ?? null}
        initialExtraction={{
          extractedCount,
          documentCount,
          hasUnextracted,
        }}
        initialJobId={liveJob?.id ?? null}
        coverage={buildCoverage(slots, failures)}
        initialStaleSince={comparisonRow?.stale_since ?? null}
        showDiagnostics={financialsDiagnosticsEnabled()}
      />
    </div>
  )
}
