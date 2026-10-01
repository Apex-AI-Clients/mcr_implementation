import { ClientDetailView } from '@/components/admin/ClientDetailView'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
}

/** An archived client file: the client page, read-only, with Restore and Delete permanently. */
export default async function ArchivedClientPage({ params }: Props) {
  const { id } = await params
  return ClientDetailView({ id, mode: 'archived' })
}
