import Link from 'next/link'
import { ClientsPageClient } from '@/components/admin/ClientsPageClient'
import { CvlClientTable } from '@/components/cvl/CvlClientTable'
import { getClientListPage } from '@/lib/clients/listing'
import { getCvlListPage } from '@/lib/cvl/listing'
import { cvlEnabled } from '@/lib/cvl/flag'

export const dynamic = 'force-dynamic'

interface Props {
  searchParams: Promise<{ q?: string; page?: string; view?: string; workflow?: string }>
}

/**
 * The Archive: client files taken off a client list — archived from the
 * client page, or because their lead was deleted. SBR and CVL files both, each
 * marked with its workflow and filtered by it; Make client again puts a file
 * back on its own workspace's list.
 *
 * "Moved to CVL" (view=moved, migration 0039): SBR clients converted to CVL.
 * Their SBR record is kept here, read-only; the file is worked on in CVL.
 */
export default async function ArchivePage({ searchParams }: Props) {
  const sp = await searchParams
  // CVL switched off: one Archive list, as before CVL.
  const cvl = cvlEnabled()
  const moved = cvl && sp.view === 'moved'
  const workflow = cvl && (sp.workflow === 'sbr' || sp.workflow === 'cvl') ? sp.workflow : undefined

  const tab = (active: boolean) =>
    `rounded-lg px-3 py-1.5 text-sm transition-colors ${
      active ? 'bg-surface font-medium text-foreground' : 'text-foreground/50 hover:text-foreground'
    }`
  const tabs = !cvl ? null : (
    <nav className="mb-6 flex flex-wrap gap-1" aria-label="Archive views">
      {(
        [
          ['All archived', undefined],
          ['SBR', 'sbr'],
          ['CVL', 'cvl'],
        ] as const
      ).map(([label, w]) => {
        const active = !moved && workflow === w
        return (
          <Link
            key={label}
            href={w ? `/sbr/archive?workflow=${w}` : '/sbr/archive'}
            className={tab(active)}
            aria-current={active ? 'page' : undefined}
          >
            {label}
          </Link>
        )
      })}
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

  const list = await getClientListPage({ q: sp.q, page: sp.page, archived: true, workflow })
  const which = workflow === 'cvl' ? 'archived CVL' : workflow === 'sbr' ? 'archived SBR' : 'archived'

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-foreground">Archive</h1>
        <p className="mt-1 text-sm text-foreground/50">
          {list.total} {which} {list.total === 1 ? 'client' : 'clients'}. Not on a client list until made a
          client again, which puts each back in its own workspace.
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
        keep={workflow ? { workflow } : undefined}
      />
    </div>
  )
}
