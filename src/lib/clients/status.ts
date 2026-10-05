import type { getSupabaseServerClient } from '@/lib/supabase/server'
import { REQUIRED_CATEGORIES, type DocCategory } from '@/lib/constants'

/**
 * A client's DOCUMENT status: whether every required category has a file.
 * Not the state of any analysis — pages about an analysis show that instead.
 *
 * Recomputed whenever a document is added or removed, so deleting the only
 * file in a required category takes a "Complete" client back to missing.
 */

type ServerClient = ReturnType<typeof getSupabaseServerClient>

/** How a missing category reads in a badge. */
const SHORT_NAME: Record<string, string> = {
  current_financials: 'current financials',
  historical_financials: 'last 4 years financials',
  integrated_client_account: 'ATO account CSV',
}

export function missingRequiredCategories(categories: Iterable<string>): DocCategory[] {
  const have = new Set(categories)
  return REQUIRED_CATEGORIES.filter((c) => !have.has(c))
}

export type BadgeVariant = 'success' | 'warning' | 'destructive' | 'muted' | 'accent'

/** The badge for a client's document status, naming what is missing. */
export function documentStatusBadge(
  status: string,
  documentCategories: Iterable<string>,
): { label: string; variant: BadgeVariant } {
  if (status === 'invited') return { label: 'Invited', variant: 'accent' }
  if (status === 'complete') return { label: 'Complete', variant: 'success' }
  if (status === 'in_progress' || status === 'missing_items') {
    const missing = missingRequiredCategories(documentCategories)
    if (missing.length === 0) return { label: 'Complete', variant: 'success' }
    return {
      label: `Missing: ${missing.map((c) => SHORT_NAME[c] ?? c).join(', ')}`,
      variant: status === 'missing_items' ? 'destructive' : 'warning',
    }
  }
  return { label: status, variant: 'muted' }
}

/** Set clients.status from the documents on file. */
export async function recomputeClientStatus(supabase: ServerClient, clientId: string): Promise<void> {
  const { data: docs } = await supabase
    .from('documents')
    .select('doc_category')
    .eq('client_id', clientId)
    .neq('status', 'rejected')

  const missing = missingRequiredCategories((docs ?? []).map((d) => d.doc_category))
  await supabase
    .from('clients')
    .update({ status: missing.length === 0 ? 'complete' : 'in_progress' })
    .eq('id', clientId)
}
