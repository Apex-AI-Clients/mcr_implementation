import { notFound, redirect } from 'next/navigation'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { loadPrintedComparison } from '@/lib/printed/store'
import { loadMapping, loadMappingChanges } from '@/lib/printed/mappingStore'
import { suggestMapping } from '@/lib/printed/dictionary'
import { aiSummariesEnabled } from '@/lib/ai/openrouterClient'
import { LineMappingClient } from './LineMappingClient'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
}

/**
 * Which printed lines are the revenue, net profit, net assets, ATO-related
 * debt, loan accounts and other creditors: suggested from the labels, confirmed
 * once by staff. The tiles and the SBR prediction use only what is confirmed.
 */
export default async function LineMappingPage({ params }: Props) {
  const { id } = await params
  const supabase = getSupabaseServerClient()
  const { data: client } = await supabase.from('clients').select('id, name, archived_at').eq('id', id).maybeSingle()
  if (!client) notFound()
  if (client.archived_at) redirect(`/sbr/archive/${client.id}`)

  const [{ comparison }, mapping, changes] = await Promise.all([
    loadPrintedComparison(supabase, id, { readMissing: true }),
    loadMapping(supabase, id),
    loadMappingChanges(supabase, id),
  ])

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <LineMappingClient
        clientId={id}
        clientName={client.name}
        comparison={comparison}
        mapping={mapping}
        suggestions={suggestMapping(comparison)}
        changes={changes}
        aiEnabled={aiSummariesEnabled()}
      />
    </div>
  )
}
