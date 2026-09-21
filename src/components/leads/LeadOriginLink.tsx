import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'

interface LeadOriginLinkProps {
  /** The lead this client file was converted from, or null. Resolved server-side. */
  leadId: string | null
}

/**
 * The other half of the join: a client file points back at the lead it came
 * from, so staff keep the history the moment someone converts.
 *
 * Resolved by the page from `leads.converted_client_id` rather than by
 * scanning the client store. That scan only ever worked while the browser
 * held every lead, and it lost the link on reload; a query holds for good.
 */
export function LeadOriginLink({ leadId }: LeadOriginLinkProps) {
  if (!leadId) return null

  return (
    <Link
      href={`/leads/${leadId}`}
      className="mt-1.5 inline-flex items-center gap-1 text-xs text-accent hover:underline"
    >
      Converted from a lead
      <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
    </Link>
  )
}
