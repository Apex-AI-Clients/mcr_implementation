import { notFound, redirect } from 'next/navigation'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { loadPrintedComparison } from '@/lib/printed/store'
import { applyAutoMapping, loadMapping, loadRelatedNames } from '@/lib/printed/mappingStore'
import { suggestMapping } from '@/lib/printed/dictionary'
import { loadVerifiedActivityAccounts } from '@/lib/ica/verifiedAccounts'
import { icaHeadline } from '@/lib/ica/balanceAt'
import type { IcaHeadline } from '@/lib/printed/headline'
import { PrintedComparisonClient } from './PrintedComparisonClient'
import { clientBase, sharedPageRedirect, type ClientPageView } from '@/lib/clients/workspace'

/**
 * The client's financial statements: the headline figures, years side by side (Gabby, 16 Nov 2026).
 * PDFs without a read by the current reader are read now (well under a
 * second each, on our own server, no model), so the page is always current.
 */
export async function FinancialsComparisonView({ id, workspace, earlierYears }: ClientPageView & { earlierYears: boolean }) {
  const base = clientBase(id, workspace)
  const supabase = getSupabaseServerClient()

  const { data: client } = await supabase.from('clients').select('id, name, archived_at, workflow, cvl_cases(removed_at)').eq('id', id).maybeSingle()
  if (!client) notFound()
  // An archived file is read in the Archive; a file in the other workspace
  // opens this page there.
  const elsewhere = sharedPageRedirect(client, workspace, '/financials-comparison')
  if (elsewhere) redirect(elsewhere)

  const [loaded, stored, names, activity] = await Promise.all([
    loadPrintedComparison(supabase, id, { readMissing: true, comparativeYears: earlierYears }),
    // Which printed lines mean what, as staff confirmed (migration 0034).
    loadMapping(supabase, id),
    loadRelatedNames(supabase, id),
    // "ATO related debt – ICA": the verified activity statement account(s) (ica/balanceAt.ts).
    loadVerifiedActivityAccounts(supabase, id).catch(() => ({ status: 'held' as const, accounts: [] })),
  ])
  // Every meaning staff have not confirmed is auto-selected (autoMapping.ts).
  const { comparison } = loaded
  const { mapping, possible } = await applyAutoMapping(supabase, id, loaded, stored, names)
  const ica: IcaHeadline = {
    status: activity.status,
    cells: activity.status === 'ok' ? icaHeadline(activity.accounts, comparison.columns.map((c) => c.periodEnd)) : [],
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <PrintedComparisonClient
        clientId={id}
        basePath={base}
        clientName={client.name}
        comparison={comparison}
        earlierYears={earlierYears}
        mapping={mapping}
        suggestions={suggestMapping(comparison, names)}
        possible={possible}
        ica={ica}
      />
    </div>
  )
}
