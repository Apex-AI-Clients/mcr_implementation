import { LeadsPageClient } from '@/components/leads/LeadsPageClient'
import { getLeadsPage } from '@/lib/leads/queries'
import { parseLeadQuery, type RawSearchParams } from '@/lib/leads/searchParams'

export const dynamic = 'force-dynamic'

interface Props {
  searchParams: Promise<RawSearchParams>
}

/**
 * Leads list.
 *
 * The URL carries the whole view — page, filters, search and sort — and this
 * component turns it into one database query. Nothing is narrowed in the
 * browser afterwards: filtering ten rows out of hundreds would report "no
 * matches" for leads that exist.
 */
export default async function LeadsPage({ searchParams }: Props) {
  const { filters, page } = parseLeadQuery(await searchParams)
  const result = await getLeadsPage({ filters, page })

  return (
    <LeadsPageClient
      filters={filters}
      leads={result.leads}
      total={result.total}
      page={result.page}
      pageCount={result.pageCount}
      pageSize={result.pageSize}
    />
  )
}
