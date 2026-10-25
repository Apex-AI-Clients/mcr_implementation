import { notFound, redirect } from 'next/navigation'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { loadPrintedComparison } from '@/lib/printed/store'
import { PrintedComparisonClient } from './PrintedComparisonClient'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
}

/**
 * The client's financial statements exactly as printed, years side by side.
 * PDFs without a read by the current reader are read now (well under a
 * second each, on our own server, no model), so the page is always current.
 */
export default async function FinancialsComparisonPage({ params }: Props) {
  const { id } = await params
  const supabase = getSupabaseServerClient()

  const { data: client } = await supabase.from('clients').select('id, name, archived_at').eq('id', id).maybeSingle()
  if (!client) notFound()
  // An archived file is viewed, read-only, in the Archive.
  if (client.archived_at) redirect(`/sbr/archive/${client.id}`)

  const [{ comparison, builtAt }, { data: figuresChecked }] = await Promise.all([
    loadPrintedComparison(supabase, id, { readMissing: true }),
    // The "I've checked these figures" tick (hardChecks.ts).
    supabase.from('sbr_readiness_reviews').select('fingerprint, reviewed_by, reviewed_at').eq('client_id', id).eq('item', 'financials').maybeSingle(),
  ])

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <PrintedComparisonClient
        clientId={id}
        clientName={client.name}
        comparison={comparison}
        builtAt={builtAt}
        initialFiguresChecked={
          figuresChecked ? { fingerprint: figuresChecked.fingerprint, by: figuresChecked.reviewed_by, at: figuresChecked.reviewed_at } : null
        }
      />
    </div>
  )
}
