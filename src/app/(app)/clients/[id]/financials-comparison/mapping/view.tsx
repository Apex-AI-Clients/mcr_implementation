import { notFound, redirect } from 'next/navigation'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { loadPrintedComparison } from '@/lib/printed/store'
import { loadMapping, loadMappingChanges, loadDirectorNames } from '@/lib/printed/mappingStore'
import { suggestMapping } from '@/lib/printed/dictionary'
import { aiSummariesEnabled } from '@/lib/ai/openrouterClient'
import { LineMappingClient } from './LineMappingClient'
import { clientBase, sharedPageRedirect, type ClientPageView } from '@/lib/clients/workspace'

/**
 * Which printed lines are the revenue, net profit, net assets, ATO-related
 * debt, loan accounts and other creditors: suggested from the labels, confirmed
 * once by staff. The tiles and the SBR prediction use only what is confirmed.
 */
export async function LineMappingView({ id, workspace }: ClientPageView) {
  const base = clientBase(id, workspace)
  const supabase = getSupabaseServerClient()
  const { data: client } = await supabase.from('clients').select('id, name, archived_at, workflow').eq('id', id).maybeSingle()
  if (!client) notFound()
  // An archived file is read in the Archive; a file in the other workspace
  // opens this page there.
  const elsewhere = sharedPageRedirect(client, workspace, '/financials-comparison/mapping')
  if (elsewhere) redirect(elsewhere)

  const [{ comparison }, mapping, changes, directors] = await Promise.all([
    loadPrintedComparison(supabase, id, { readMissing: true }),
    loadMapping(supabase, id),
    loadMappingChanges(supabase, id),
    loadDirectorNames(supabase, id),
  ])

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <LineMappingClient
        clientId={id}
        basePath={base}
        clientName={client.name}
        comparison={comparison}
        mapping={mapping}
        suggestions={suggestMapping(comparison, { directors })}
        changes={changes}
        aiEnabled={aiSummariesEnabled()}
      />
    </div>
  )
}
