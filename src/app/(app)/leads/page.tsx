import { LeadsPageClient } from '@/components/leads/LeadsPageClient'
import { getLeadSourceOptions, getLeadViewCounts, getLeadsPage } from '@/lib/leads/queries'
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

  return (
    <LeadsPageClient
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
