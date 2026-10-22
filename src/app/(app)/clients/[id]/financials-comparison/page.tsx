import { notFound, redirect } from 'next/navigation'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { FINANCIAL_STATEMENT_CATEGORIES } from '@/lib/constants'
import { ComparisonClient } from './ComparisonClient'
import { buildCoverage } from '@/lib/financials/coverage'
import { describeFinancialFiles, overrideYearOptions } from '@/lib/financials/financialFiles'
import { periodOverrideOf } from '@/lib/financials/periodOverride'
import type { FinancialDocumentKind } from '@/lib/financials/types'
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
    { data: company },
    { data: figuresChecked },
  ] = await Promise.all([
    supabase
      .from('documents')
      .select('id, original_filename, uploaded_at, fs_override_kind, fs_override_fy, fs_override_by, fs_override_at')
      .eq('client_id', id)
      .in('doc_category', FINANCIAL_STATEMENT_CATEGORIES)
      .order('uploaded_at', { ascending: true }),
    supabase
      .from('financial_statements')
      .select('id, document_id, is_document_id, bs_document_id')
      .eq('client_id', id),
    // Documents the pre-pass has seen, including ones that stored nothing
    // (a trust deed in a financials slot) — they are not "unextracted".
    supabase
      .from('financial_document_extractions')
      .select('document_id, kind, extracted_at')
      .eq('client_id', id),
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
    // "The company" / "The trust" in the financial points.
    supabase.from('company_details').select('entity_type').eq('client_id', id).maybeSingle(),
    // The "I've checked these figures" tick (hardChecks.ts).
    supabase
      .from('sbr_readiness_reviews')
      .select('fingerprint, reviewed_by, reviewed_at')
      .eq('client_id', id)
      .eq('item', 'financials')
      .maybeSingle(),
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
        files={describeFinancialFiles({
          documents: (documents ?? []).map((d) => ({
            id: d.id,
            filename: d.original_filename,
            override: periodOverrideOf(d),
            overrideBy: d.fs_override_by,
            overrideAt: d.fs_override_at,
          })),
          slots,
          extractions: (recorded ?? []).map((r) => ({
            documentId: r.document_id,
            kind: r.kind as FinancialDocumentKind,
            extractedAt: r.extracted_at,
          })),
        })}
        overrideYears={overrideYearOptions()}
        initialStaleSince={comparisonRow?.stale_since ?? null}
        entityType={company?.entity_type ?? null}
        initialFiguresChecked={
          figuresChecked
            ? { fingerprint: figuresChecked.fingerprint, by: figuresChecked.reviewed_by, at: figuresChecked.reviewed_at }
            : null
        }
        showDiagnostics={financialsDiagnosticsEnabled()}
      />
    </div>
  )
}
