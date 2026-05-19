import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { LodgementAnalysisCard } from '@/components/admin/LodgementAnalysisCard'
import { Badge } from '@/components/ui/Badge'
import type { LodgementAnalysisPayload } from '@/lib/analysis/types'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
}

export default async function LodgementAnalysisPage({ params }: Props) {
  const { id } = await params
  const supabase = getSupabaseServerClient()

  const { data: client } = await supabase.from('clients').select('*').eq('id', id).single()
  if (!client) notFound()

  const [{ data: rawDocs }, { data: rawAnalysis }] = await Promise.all([
    supabase
      .from('documents')
      .select('original_filename, doc_category')
      .eq('client_id', id),
    supabase
      .from('lodgement_analyses')
      .select('*')
      .eq('client_id', id)
      .order('analysed_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const hasActivityStatementCsv = (rawDocs ?? []).some(
    (d) =>
      d.doc_category === 'integrated_client_account' &&
      d.original_filename.toLowerCase().includes('activity statement') &&
      d.original_filename.toLowerCase().endsWith('.csv'),
  )

  const initialAnalysis: LodgementAnalysisPayload | null = rawAnalysis
    ? {
        id: rawAnalysis.id,
        clientId: rawAnalysis.client_id,
        documentId: rawAnalysis.document_id,
        sourceFilename: rawAnalysis.source_filename,
        statementLabel: rawAnalysis.statement_label,
        companyNameInCsv: rawAnalysis.company_name_in_csv,
        rowCount: rawAnalysis.row_count,
        summary: {
          numberOfLateLodgements: rawAnalysis.number_of_late_lodgements,
          cumulativeDaysLate: rawAnalysis.cumulative_days_late,
        },
        dpnRisk: (() => {
          const raw = rawAnalysis.dpn_risk as Record<string, unknown> | null
          if (!raw || !Array.isArray(raw['contributingDebits'])) return null
          return raw as unknown as LodgementAnalysisPayload['dpnRisk']
        })(),
        debtBreakdown: (() => {
          const raw = rawAnalysis.debt_breakdown as Record<string, unknown> | null
          if (!raw || typeof raw['principalDebits'] !== 'number') return null
          return raw as unknown as LodgementAnalysisPayload['debtBreakdown']
        })(),
        aiSummary: rawAnalysis.ai_summary ?? null,
        aiSummaryGeneratedAt: rawAnalysis.ai_summary_generated_at ?? null,
        rows: rawAnalysis.rows as LodgementAnalysisPayload['rows'],
        warnings: rawAnalysis.warnings as LodgementAnalysisPayload['warnings'],
        analysedAt: rawAnalysis.analysed_at,
      }
    : null

  const STATUS_LABELS: Record<
    string,
    { label: string; variant: 'success' | 'warning' | 'destructive' | 'muted' | 'accent' }
  > = {
    invited: { label: 'Invited', variant: 'accent' },
    in_progress: { label: 'Uploading', variant: 'warning' },
    complete: { label: 'Complete', variant: 'success' },
    missing_items: { label: 'Missing Items', variant: 'destructive' },
  }
  const statusBadge = STATUS_LABELS[client.status] ?? { label: client.status, variant: 'muted' }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <Link
        href={`/admin/clients/${id}`}
        className="mb-6 inline-flex items-center gap-1.5 text-xs text-foreground/40 hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to {client.name}
      </Link>

      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Lodgement Compliance Analysis</h1>
          <p className="mt-0.5 text-sm text-foreground/50">{client.name} · {client.email}</p>
        </div>
        <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
      </div>

      {rawAnalysis && !initialAnalysis?.dpnRisk && (
        <div className="mb-3 rounded-lg border border-warning/30 bg-warning/5 px-4 py-3 text-xs text-warning">
          This analysis was generated with an outdated method. Click <strong>Re-analyse</strong> to refresh it.
        </div>
      )}

      <LodgementAnalysisCard
        clientId={id}
        initialAnalysis={initialAnalysis}
        hasActivityStatementCsv={hasActivityStatementCsv}
      />
    </div>
  )
}
