import Link from 'next/link'
import { ClientsPageClient } from '@/components/admin/ClientsPageClient'
import { CvlClientTable } from '@/components/cvl/CvlClientTable'
import { getClientListPage } from '@/lib/clients/listing'
import { getCvlListPage } from '@/lib/cvl/listing'

export const dynamic = 'force-dynamic'

interface Props {
  searchParams: Promise<{ q?: string; page?: string; view?: string }>
}

/**
 * The Archive: client files taken off the client list — archived from the
 * client page, or because their lead was deleted. The same list as Clients,
 * with Make client again and Delete permanently in place of Archive.
 *
 * "Moved to CVL" (view=moved, migration 0039): SBR clients converted to CVL.
 * Their SBR record is kept here, read-only; the file is worked on in CVL.
 */
export default async function ArchivePage({ searchParams }: Props) {
  const sp = await searchParams
  const moved = sp.view === 'moved'

  const tab = (active: boolean) =>
    `rounded-lg px-3 py-1.5 text-sm transition-colors ${
      active ? 'bg-surface font-medium text-foreground' : 'text-foreground/50 hover:text-foreground'
    }`
  const tabs = (
    <nav className="mb-6 flex gap-1" aria-label="Archive views">
      <Link href="/sbr/archive" className={tab(!moved)} aria-current={!moved ? 'page' : undefined}>
        Archived
      </Link>
      <Link href="/sbr/archive?view=moved" className={tab(moved)} aria-current={moved ? 'page' : undefined}>
        Moved to CVL
      </Link>
    </nav>
  )

  if (moved) {
    const list = await getCvlListPage({ q: sp.q, page: sp.page, movedFromSbr: true })
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-foreground">Archive</h1>
          <p className="mt-1 text-sm text-foreground/50">
            {list.total} {list.total === 1 ? 'client' : 'clients'} moved to CVL. Their SBR records are kept here,
            read-only.
          </p>
        </div>
        {tabs}
        <CvlClientTable
          list={list}
          path="/sbr/archive"
          keep={{ view: 'moved' }}
          rowHref={(clientId) => `/sbr/archive/${clientId}`}
          moved
          empty="No SBR client has been moved to CVL."
        />
      </div>
    )
  }

  const list = await getClientListPage({ q: sp.q, page: sp.page, archived: true })

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-foreground">Archive</h1>
        <p className="mt-1 text-sm text-foreground/50">
          {list.total} archived {list.total === 1 ? 'client' : 'clients'}. Not on the client list
          until made a client again.
        </p>
      </div>
      {tabs}

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
