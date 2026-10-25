import { notFound, redirect } from 'next/navigation'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { loadPrintedComparison } from '@/lib/printed/store'
import { loadMapping } from '@/lib/printed/mappingStore'
import { suggestMapping } from '@/lib/printed/dictionary'
import { aiSummariesEnabled } from '@/lib/ai/openrouterClient'
import { PrintedComparisonClient } from './PrintedComparisonClient'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
  /** earlier=1: also the years printed only as a comparative column. */
  searchParams: Promise<{ earlier?: string }>
}

/**
 * The client's financial statements exactly as printed, years side by side.
 * PDFs without a read by the current reader are read now (well under a
 * second each, on our own server, no model), so the page is always current.
 */
export default async function FinancialsComparisonPage({ params, searchParams }: Props) {
  const { id } = await params
  const earlierYears = (await searchParams).earlier === '1'
  const supabase = getSupabaseServerClient()

  const { data: client } = await supabase.from('clients').select('id, name, archived_at').eq('id', id).maybeSingle()
  if (!client) notFound()
  // An archived file is viewed, read-only, in the Archive.
  if (client.archived_at) redirect(`/sbr/archive/${client.id}`)

  const [{ comparison, builtAt }, { data: figuresChecked }, mapping] = await Promise.all([
    loadPrintedComparison(supabase, id, { readMissing: true, comparativeYears: earlierYears }),
    // The "I've checked these figures" tick (hardChecks.ts).
    supabase.from('sbr_readiness_reviews').select('fingerprint, reviewed_by, reviewed_at').eq('client_id', id).eq('item', 'financials').maybeSingle(),
    // Which printed lines mean what, as staff confirmed (migration 0034).
    loadMapping(supabase, id),
  ])

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <PrintedComparisonClient
        clientId={id}
        clientName={client.name}
        comparison={comparison}
        builtAt={builtAt}
        earlierYears={earlierYears}
        aiSummaryEnabled={aiSummariesEnabled()}
        mapping={mapping}
        suggestions={suggestMapping(comparison)}
        initialFiguresChecked={
          figuresChecked ? { fingerprint: figuresChecked.fingerprint, by: figuresChecked.reviewed_by, at: figuresChecked.reviewed_at } : null
        }
      />
    </div>
  )
}
