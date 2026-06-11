import { notFound } from 'next/navigation'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { ComparisonClient } from './ComparisonClient'
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
    .select('id, name')
    .eq('id', id)
    .maybeSingle()
  if (!client) notFound()

  const [
    { data: documents },
    { data: statements },
    { data: comparisonRow },
    { data: activeJob },
  ] = await Promise.all([
    supabase
      .from('documents')
      .select('id')
      .eq('client_id', id)
      .eq('doc_category', 'historical_financials'),
    supabase
      .from('financial_statements')
      .select('id, document_id, financial_year')
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
      .select('id')
      .eq('client_id', id)
      .in('status', ['pending', 'processing'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const documentCount = documents?.length ?? 0
  // Use distinct document_ids that produced a statement — a single PDF can
  // yield two FY rows (primary + comparative).
  const extractedDocIds = new Set((statements ?? []).map((s) => s.document_id))
  const extractedCount = (statements ?? []).length
  const documentIds = new Set((documents ?? []).map((d) => d.id))
  const hasUnextracted = [...documentIds].some((d) => !extractedDocIds.has(d))

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
        initialJobId={activeJob?.id ?? null}
      />
    </div>
  )
}
