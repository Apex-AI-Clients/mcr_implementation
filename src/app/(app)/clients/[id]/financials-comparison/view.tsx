import { notFound, redirect } from 'next/navigation'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { loadPrintedComparison } from '@/lib/printed/store'
import { loadDirectorNames, loadMapping } from '@/lib/printed/mappingStore'
import { suggestMapping } from '@/lib/printed/dictionary'
import { aiSummariesEnabled } from '@/lib/ai/openrouterClient'
import { PrintedComparisonClient } from './PrintedComparisonClient'
import { clientBase, sharedPageRedirect, type ClientPageView } from '@/lib/clients/workspace'

/**
 * The client's financial statements exactly as printed, years side by side.
 * PDFs without a read by the current reader are read now (well under a
 * second each, on our own server, no model), so the page is always current.
 */
export async function FinancialsComparisonView({ id, workspace, earlierYears }: ClientPageView & { earlierYears: boolean }) {
  const base = clientBase(id, workspace)
  const supabase = getSupabaseServerClient()

  const { data: client } = await supabase.from('clients').select('id, name, archived_at, workflow').eq('id', id).maybeSingle()
  if (!client) notFound()
  // An archived file is read in the Archive; a file in the other workspace
  // opens this page there.
  const elsewhere = sharedPageRedirect(client, workspace, '/financials-comparison')
  if (elsewhere) redirect(elsewhere)

  const [{ comparison, builtAt }, { data: figuresChecked }, mapping, directors] = await Promise.all([
    loadPrintedComparison(supabase, id, { readMissing: true, comparativeYears: earlierYears }),
    // The "I've checked these figures" tick (hardChecks.ts).
    supabase.from('sbr_readiness_reviews').select('fingerprint, reviewed_by, reviewed_at').eq('client_id', id).eq('item', 'financials').maybeSingle(),
    // Which printed lines mean what, as staff confirmed (migration 0034).
    loadMapping(supabase, id),
    loadDirectorNames(supabase, id),
  ])

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <PrintedComparisonClient
        clientId={id}
        basePath={base}
        clientName={client.name}
        comparison={comparison}
        builtAt={builtAt}
        earlierYears={earlierYears}
        aiSummaryEnabled={aiSummariesEnabled()}
        mapping={mapping}
        suggestions={suggestMapping(comparison, { directors })}
        initialFiguresChecked={
          figuresChecked ? { fingerprint: figuresChecked.fingerprint, by: figuresChecked.reviewed_by, at: figuresChecked.reviewed_at } : null
        }
      />
    </div>
  )
}
