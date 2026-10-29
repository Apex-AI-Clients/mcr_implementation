import Link from 'next/link'
import { CvlClientTable } from '@/components/cvl/CvlClientTable'
import { getCvlListPage } from '@/lib/cvl/listing'

export const dynamic = 'force-dynamic'

interface Props {
  searchParams: Promise<{ q?: string; page?: string }>
}

/**
 * The CVL workspace: client files in liquidation, converted from an SBR
 * client (Convert to CVL on the client page) or straight from a lead.
 */
export default async function CvlClientsPage({ searchParams }: Props) {
  const sp = await searchParams
  const list = await getCvlListPage({ q: sp.q, page: sp.page })

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-8">
        <h1 className="text-xl font-semibold text-foreground">CVL clients</h1>
        <p className="mt-1 text-sm text-foreground/50">
          {list.total} {list.total === 1 ? 'client' : 'clients'} in creditors&rsquo; voluntary liquidation.{' '}
          <Link href="/sbr/archive?workflow=cvl" className="text-accent hover:underline">
            Archived CVL files
          </Link>
        </p>
      </div>
      <CvlClientTable
        list={list}
        path="/cvl"
        rowHref={(clientId) => `/cvl/${clientId}`}
        empty="No CVL clients yet. Convert an SBR client from its client page, or a lead from the CRM."
      />
    </div>
  )
}
