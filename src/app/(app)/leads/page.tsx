import { LeadsPageClient } from '@/components/leads/LeadsPageClient'

export const dynamic = 'force-dynamic'

/**
 * Leads list. The mock seed is loaded once in `(app)/layout.tsx` and held in
 * LeadsStoreProvider so the sidebar's follow-up count and this list stay in
 * step; Stage 4 swaps that seed for a Supabase query.
 */
export default function LeadsPage() {
  return <LeadsPageClient />
}
