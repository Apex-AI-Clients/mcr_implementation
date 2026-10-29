import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { AtoAccountReport } from '@/components/admin/atoAccount/AtoAccountReport'
import type { AtoAccountPayload } from '@/lib/analysis/atoAccount/exportCsv'
import type { AccountComposition } from '@/lib/analysis/atoAccount/engine'
import { isClaudeSummary } from '@/lib/ai/lodgementSummary'
import { clientBase, sharedPageRedirect, type ClientPageView } from '@/lib/clients/workspace'

/**
 * An income tax or superannuation guarantee account's summary, from its
 * stored analysis (atoAccount/store.ts). Activity statement accounts have the
 * lodgement analysis page instead.
 */
export async function AtoAccountView({ id, analysisId, workspace }: ClientPageView & { analysisId: string }) {
  const base = clientBase(id, workspace)
  const supabase = getSupabaseServerClient()

  const { data: client } = await supabase.from('clients').select('id, name, archived_at, workflow').eq('id', id).maybeSingle()
  if (!client) notFound()
  // An archived file is read in the Archive; a file in the other workspace
  // opens this page there.
  const elsewhere = sharedPageRedirect(client, workspace, `/ato-accounts/${analysisId}`)
  if (elsewhere) redirect(elsewhere)

  const { data: row } = await supabase
    .from('ato_account_analyses')
    .select('*, documents(original_filename)')
    .eq('id', analysisId)
    .eq('client_id', id)
    .maybeSingle()
  if (!row) notFound()
  if (row.account_kind === 'activity_statement') redirect(`${base}/lodgement-compliance-analysis`)

  const doc = row.documents as { original_filename: string } | { original_filename: string }[] | null
  const payload = {
    id: row.id,
    clientId: row.client_id,
    kind: row.account_kind,
    label: row.account_label,
    entityName: row.entity_name,
    entityMatches: row.entity_matches,
    sourceFilename: (Array.isArray(doc) ? doc[0] : doc)?.original_filename ?? null,
    balance: row.balance === null ? null : Number(row.balance),
    balanceDate: row.balance_date,
    unexplained: row.unexplained_difference === null ? null : Number(row.unexplained_difference),
    needsReview: row.needs_review,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    analysedAt: row.analysed_at,
    composition: row.composition as unknown as AccountComposition,
    summary: row.summary,
    // Only a summary written by Claude under the figure check; an older one is written again.
    aiSummary: isClaudeSummary(row.ai_summary_model) ? row.ai_summary : null,
    aiSummaryGeneratedAt: isClaudeSummary(row.ai_summary_model) ? row.ai_summary_generated_at : null,
  } as unknown as AtoAccountPayload

  return (
    <div id="ato-account-export-root" className="mx-auto max-w-4xl p-6">
      <Link
        href={base}
        className="no-print mb-6 inline-flex items-center gap-1.5 text-xs text-foreground/40 transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to {client.name}
      </Link>
      <AtoAccountReport payload={payload} clientName={client.name} />
    </div>
  )
}
