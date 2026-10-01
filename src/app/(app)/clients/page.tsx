import Link from 'next/link'
import { UserPlus } from 'lucide-react'
import { ClientsPageClient } from '@/components/admin/ClientsPageClient'
import { getClientListPage } from '@/lib/clients/listing'

export const dynamic = 'force-dynamic'

interface Props {
  searchParams: Promise<{ q?: string; page?: string }>
}

export default async function ClientsPage({ searchParams }: Props) {
  const sp = await searchParams
  // Active files only. Archived ones are in the Archive (/sbr/archive).
  const list = await getClientListPage({ q: sp.q, page: sp.page, archived: false })

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Clients</h1>
          <p className="mt-1 text-sm text-foreground/50">
            {list.total} {list.total === 1 ? 'client' : 'clients'} total
          </p>
        </div>
        <Link
          href="/clients/new/intake"
          className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent/90"
        >
          <UserPlus className="h-4 w-4" />
          Add Client
        </Link>
      </div>

      <ClientsPageClient
        clients={list.clients}
        total={list.total}
        page={list.page}
        pageSize={list.pageSize}
        query={list.query}
      />
    </div>
  )
}
