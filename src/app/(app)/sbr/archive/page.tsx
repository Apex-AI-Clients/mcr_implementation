import { ClientsPageClient } from '@/components/admin/ClientsPageClient'
import { getClientListPage } from '@/lib/clients/listing'

export const dynamic = 'force-dynamic'

interface Props {
  searchParams: Promise<{ q?: string; page?: string }>
}

/**
 * The Archive: client files taken off the client list — archived from the
 * client page, or because their lead was deleted. The same list as Clients,
 * with Make client again and Delete permanently in place of Archive.
 */
export default async function ArchivePage({ searchParams }: Props) {
  const sp = await searchParams
  const list = await getClientListPage({ q: sp.q, page: sp.page, archived: true })

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-8">
        <h1 className="text-xl font-semibold text-foreground">Archive</h1>
        <p className="mt-1 text-sm text-foreground/50">
          {list.total} archived {list.total === 1 ? 'client' : 'clients'}. Not on the client list
          until made a client again.
        </p>
      </div>

      <ClientsPageClient
        clients={list.clients}
        total={list.total}
        page={list.page}
        pageSize={list.pageSize}
        query={list.query}
        mode="archived"
      />
    </div>
  )
}
