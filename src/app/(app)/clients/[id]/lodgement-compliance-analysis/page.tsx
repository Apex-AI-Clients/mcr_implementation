import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { LodgementAnalysisCard } from '@/components/admin/LodgementAnalysisCard'
import { Badge } from '@/components/ui/Badge'
import type { LodgementAnalysisPayload } from '@/lib/analysis/types'
import { reanalyseStoredRows } from '@/lib/analysis/computeLateLodgement'
import { loadDpnNoticeFigures } from '@/lib/dpn/loadNoticeFigures'
import { isClaudeSummary } from '@/lib/ai/lodgementSummary'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
}

export default async function LodgementAnalysisPage({ params }: Props) {
  const { id } = await params
  const supabase = getSupabaseServerClient()

  const { data: client } = await supabase.from('clients').select('*').eq('id', id).single()
  if (!client) notFound()
  // An archived file is viewed, read-only, in the Archive.
  if (client.archived_at) redirect(`/sbr/archive/${client.id}`)

  const [{ data: rawDocs }, { data: rawAnalysis }, dpnNotices] = await Promise.all([
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
    // The ATO's director penalty notices, when on file: the DPN panel shows
    // their figures instead of the estimate from the account.
    loadDpnNoticeFigures(supabase, id).catch(() => null),
  ])

  // Any CSV in the account category may be the activity statement export: the
  // analysis recognises it by its content, not its filename, and says so if
  // none of them is one.
  const hasActivityStatementCsv = (rawDocs ?? []).some(
    (d) => d.doc_category === 'integrated_client_account' && d.original_filename.toLowerCase().endsWith('.csv'),
  )

  // The saved totals are whatever the code computed on the day; re-run today's
  // code (and late-lodgement setting) over the saved rows instead, so a saved
  // analysis follows every fix without being re-analysed. The saved totals are
  // used only when the rows cannot be read.
  const current = rawAnalysis ? reanalyseStoredRows(rawAnalysis.rows) : null

  const initialAnalysis: LodgementAnalysisPayload | null = rawAnalysis
    ? {
        id: rawAnalysis.id,
        clientId: rawAnalysis.client_id,
        documentId: rawAnalysis.document_id,
        sourceFilename: rawAnalysis.source_filename,
        statementLabel: rawAnalysis.statement_label,
        companyNameInCsv: rawAnalysis.company_name_in_csv,
        rowCount: rawAnalysis.row_count,
        summary: current?.summary ?? {
          numberOfLateLodgements: rawAnalysis.number_of_late_lodgements,
          cumulativeDaysLate: rawAnalysis.cumulative_days_late,
        },
        dpnRisk: current?.dpnRisk ?? (() => {
          const raw = rawAnalysis.dpn_risk as Record<string, unknown> | null
          if (!raw || !Array.isArray(raw['contributingDebits'])) return null
          return raw as unknown as LodgementAnalysisPayload['dpnRisk']
        })(),
        debtBreakdown: current?.debtBreakdown ?? (() => {
          const raw = rawAnalysis.debt_breakdown as Record<string, unknown> | null
          if (!raw || typeof raw['principalDebits'] !== 'number') return null
          return raw as unknown as LodgementAnalysisPayload['debtBreakdown']
        })(),
        // Only a summary written by Claude under the figure check (lodgementSummary.ts); an older one is written again.
        aiSummary: isClaudeSummary(rawAnalysis.ai_summary_model) ? (rawAnalysis.ai_summary ?? null) : null,
        aiSummaryGeneratedAt: isClaudeSummary(rawAnalysis.ai_summary_model) ? (rawAnalysis.ai_summary_generated_at ?? null) : null,
        rows: (current?.rows ?? rawAnalysis.rows) as LodgementAnalysisPayload['rows'],
        warnings: rawAnalysis.warnings as LodgementAnalysisPayload['warnings'],
        analysedAt: rawAnalysis.analysed_at,
      }
    : null

  // This page is about the analysis, so its badge is the analysis state. The
  // client's document status ("Missing: …") belongs on the client page.
  const statusBadge = rawAnalysis
    ? {
        label: `Analysed ${new Date(rawAnalysis.analysed_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}`,
        variant: 'success' as const,
      }
    : { label: 'Not analysed yet', variant: 'muted' as const }

  return (
    <div id="lodgement-export-root" className="p-6 max-w-4xl mx-auto">
      <Link
        href={`/clients/${id}`}
        className="no-print mb-6 inline-flex items-center gap-1.5 text-xs text-foreground/40 hover:text-foreground transition-colors"
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
        dpnNotices={dpnNotices}
      />
    </div>
  )
}
