import { ClientDetailView } from '@/components/admin/ClientDetailView'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
}

export default async function ClientDetailPage({ params }: Props) {
  const { id } = await params
  // Awaited rather than rendered as <ClientDetailView />: it is an async server
  // component, and this way the page is the one async boundary.
  return ClientDetailView({ id, mode: 'active' })
}
