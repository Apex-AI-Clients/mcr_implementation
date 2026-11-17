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
import { icaViewOf } from '@/lib/ica/view'
import { loadFactorsSourceNote } from '@/lib/analysis/atoAccount/store'
import { clientBase, sharedPageRedirect, type ClientPageView } from '@/lib/clients/workspace'

export async function LodgementAnalysisView({ id, workspace }: ClientPageView) {
  const base = clientBase(id, workspace)
  const supabase = getSupabaseServerClient()

  const { data: client } = await supabase.from('clients').select('*, cvl_cases(removed_at)').eq('id', id).single()
  if (!client) notFound()
  // An archived file is read in the Archive; a file in the other workspace
  // opens this page there.
  const elsewhere = sharedPageRedirect(client, workspace, '/lodgement-compliance-analysis')
  if (elsewhere) redirect(elsewhere)

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
    (d) => d.doc_category === 'integrated_client_account' && /\.(csv|xlsx)$/i.test(d.original_filename),
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
        // Today's parser over the saved cells; the saved count when the rows cannot be read.
        unparsedDateRows: current?.unparsedDateRows ?? rawAnalysis.unparsed_date_rows ?? 0,
        analysedAt: rawAnalysis.analysed_at,
        // Checked against the ATO's own balance (migration 0058): only a verified file's figures are shown.
        verification: icaViewOf({
          rows: rawAnalysis.rows,
          label: rawAnalysis.statement_label,
          ica_status: rawAnalysis.ica_status,
          ica_forced: rawAnalysis.ica_forced,
          ica_check: rawAnalysis.ica_check,
        }),
      }
    : null

  // With two activity statement accounts (001 and 002), which one this is.
  const factorsSource = await loadFactorsSourceNote(supabase, id, rawAnalysis?.statement_label ?? null)

  // This page is about the analysis, so its badge is the analysis state. The
  // client's document status ("Missing: …") belongs on the client page.
  const statusBadge = initialAnalysis && initialAnalysis.unparsedDateRows > 0
    ? { label: 'Failed: dates unreadable', variant: 'destructive' as const }
    : initialAnalysis && !initialAnalysis.verification?.verified
    ? { label: 'Totals being prepared', variant: 'muted' as const }
    : rawAnalysis
    ? {
        label: `Analysed ${new Date(rawAnalysis.analysed_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}`,
        variant: 'success' as const,
      }
    : { label: 'Not analysed yet', variant: 'muted' as const }

  return (
    <div id="lodgement-export-root" className="p-6 max-w-4xl mx-auto">
      <Link
        href={base}
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

      {factorsSource && (
        <p className="mb-3 rounded-lg border border-border bg-surface/50 px-4 py-2 text-xs text-foreground/70">{factorsSource}</p>
      )}

      <LodgementAnalysisCard
        clientId={id}
        basePath={base}
        initialAnalysis={initialAnalysis}
        hasActivityStatementCsv={hasActivityStatementCsv}
        dpnNotices={dpnNotices}
      />
    </div>
  )
}
