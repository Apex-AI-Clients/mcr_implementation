import { notFound } from 'next/navigation'
import { ClientsPageClient } from '@/components/admin/ClientsPageClient'
import { getClientListPage } from '@/lib/clients/listing'
import { cvlEnabled } from '@/lib/cvl/flag'

export const dynamic = 'force-dynamic'

interface Props {
  searchParams: Promise<{ q?: string; page?: string }>
}

/**
 * The CVL workspace's Archive: the archived CVL files, the same list as the
 * SBR Archive's CVL tab, kept inside the CVL workspace so its sidebar stays.
 * Make client again puts a file back on the CVL list.
 */
export default async function CvlArchivePage({ searchParams }: Props) {
  if (!cvlEnabled()) notFound()
  const sp = await searchParams
  const list = await getClientListPage({ q: sp.q, page: sp.page, archived: true, workflow: 'cvl' })

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-foreground">Archive</h1>
        <p className="mt-1 text-sm text-foreground/50">
          {list.total} archived CVL {list.total === 1 ? 'client' : 'clients'}. Not on the CVL list until made a
          client again.
        </p>
      </div>

      <ClientsPageClient
        clients={list.clients}
        total={list.total}
        page={list.page}
        pageSize={list.pageSize}
        query={list.query}
        mode="archived"
        path="/cvl/archive"
      />
    </div>
  )
}
