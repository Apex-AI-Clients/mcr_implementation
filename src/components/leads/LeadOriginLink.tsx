'use client'

import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'
import { useLeads } from '@/components/leads/LeadsStore'

interface LeadOriginLinkProps {
  clientId: string
}

/**
 * The other half of the join: a client file points back at the lead it came
 * from, so staff keep the history the moment someone converts.
 *
 * The link is resolved from the CRM store rather than the database because the
 * lead → client relationship lives in memory until Stage 4 adds
 * `leads.converted_client_id`. That means it holds for the session in which the
 * conversion happened, and after a reload there is nothing to show — so this
 * renders nothing rather than something wrong.
 */
export function LeadOriginLink({ clientId }: LeadOriginLinkProps) {
  const { leads } = useLeads()
  const origin = leads.find((lead) => lead.convertedClientId === clientId)

  if (!origin) return null

  return (
    <Link
      href={`/leads/${origin.id}`}
      className="mt-1.5 inline-flex items-center gap-1 text-xs text-accent hover:underline"
    >
      Converted from a lead
      <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
    </Link>
  )
}
