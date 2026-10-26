import { LeadsPageClient } from '@/components/leads/LeadsPageClient'
import { getLeadSourceOptions, getLeadViewCounts, getLeadsPage, getNotesForLeads } from '@/lib/leads/queries'
import { NOTES_VIEWS } from '@/lib/leads/notes'
import { parseLeadQuery, type RawSearchParams } from '@/lib/leads/searchParams'

export const dynamic = 'force-dynamic'

interface Props {
  searchParams: Promise<RawSearchParams>
}

/**
 * Leads list, one tab in the header per group of stages (LEAD_VIEWS). It
 * opens on Leads: only the active leads.
 *
 * The URL carries the whole view — tab, page, filters, search and sort — and
 * this component turns it into one database query. Nothing is narrowed in
 * the browser afterwards: filtering ten rows out of hundreds would report
 * "no matches" for leads that exist.
 */
export default async function LeadsPage({ searchParams }: Props) {
  const { filters, page } = parseLeadQuery(await searchParams)
  const view = filters.view === 'all' ? 'leads' : filters.view
  const [result, sources, counts] = await Promise.all([
    getLeadsPage({ filters: { ...filters, view }, page }),
    getLeadSourceOptions(),
    getLeadViewCounts(filters),
  ])

  // The closed tabs show each lead's notes: why it went nowhere, or why not to call.
  const notes = NOTES_VIEWS.includes(view) ? await getNotesForLeads(result.leads.map((lead) => lead.id)) : undefined

  return (
    <LeadsPageClient
      notes={notes}
      filters={{ ...filters, view }}
      leads={result.leads}
      total={result.total}
      page={result.page}
      pageCount={result.pageCount}
      pageSize={result.pageSize}
      view={view}
      sources={sources}
      counts={counts}
    />
  )
}
