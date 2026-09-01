import { getSupabaseServerClient } from '@/lib/supabase/server'
import { REQUIRED_CATEGORIES } from '@/lib/constants'

/**
 * Single definition of "complete" for a client file.
 *
 * Both the workspace chooser (`/`) and the SBR dashboard (`/sbr`) report on
 * document collection, and they must never disagree about which files are
 * done. The rule lives here once: a file is complete when every category in
 * REQUIRED_CATEGORIES has at least one non-rejected document. The three
 * optional categories don't count towards it — same rule the upload route
 * uses when it sets client status.
 */

export interface ClientCompleteness {
  id: string
  name: string
  createdAt: string
  /** Distinct REQUIRED categories with at least one non-rejected document. */
  requiredMet: number
  isComplete: boolean
  /** Percentage of required categories collected, 0–100. */
  pct: number
}

export interface CompletenessSummary {
  clients: ClientCompleteness[]
  /** Required categories per client — the denominator for `requiredMet`. */
  requiredTotal: number
  totalClients: number
  /** Every non-rejected document across all clients. */
  totalDocuments: number
  completeClients: number
  /** Clients still missing at least one required category. */
  awaitingDocuments: number
  /** Required categories collected across the whole portfolio. */
  requiredCollected: number
  /** totalClients × requiredTotal. */
  requiredPossible: number
  /** Portfolio-wide completeness, 0–100. */
  overallPct: number
}

export async function getCompletenessSummary(): Promise<CompletenessSummary> {
  const supabase = getSupabaseServerClient()

  const [{ data: clients }, { data: documents }] = await Promise.all([
    supabase.from('clients').select('id, name, created_at').order('created_at', { ascending: false }),
    supabase.from('documents').select('client_id, doc_category, status'),
  ])

  // Count unique (non-rejected) categories per client.
  const docsPerClient = new Map<string, Set<string>>()
  let totalDocuments = 0
  for (const doc of documents ?? []) {
    if (doc.status === 'rejected') continue
    totalDocuments++
    if (!docsPerClient.has(doc.client_id)) docsPerClient.set(doc.client_id, new Set())
    docsPerClient.get(doc.client_id)!.add(doc.doc_category)
  }

  const requiredTotal = REQUIRED_CATEGORIES.length

  const summaries: ClientCompleteness[] = (clients ?? []).map((c) => {
    const met = REQUIRED_CATEGORIES.filter((cat) => docsPerClient.get(c.id)?.has(cat)).length
    return {
      id: c.id,
      name: c.name,
      createdAt: c.created_at,
      requiredMet: met,
      isComplete: met >= requiredTotal,
      pct: requiredTotal ? Math.round((met / requiredTotal) * 100) : 0,
    }
  })

  const totalClients = summaries.length
  const completeClients = summaries.filter((c) => c.isComplete).length
  const requiredCollected = summaries.reduce((sum, c) => sum + c.requiredMet, 0)
  const requiredPossible = totalClients * requiredTotal

  return {
    clients: summaries,
    requiredTotal,
    totalClients,
    totalDocuments,
    completeClients,
    awaitingDocuments: totalClients - completeClients,
    requiredCollected,
    requiredPossible,
    overallPct: requiredPossible ? Math.round((requiredCollected / requiredPossible) * 100) : 0,
  }
}
