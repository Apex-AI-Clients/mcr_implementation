import { ClientDetailView } from '@/components/admin/ClientDetailView'

export const dynamic = 'force-dynamic'

/** Opening the page starts any analysis that is waiting (ClientDetailView), as the SBR client page does. */
export const maxDuration = 800

interface Props {
  params: Promise<{ id: string }>
}

/** A CVL client file: status, details, documents, the ASIC forms and the analyses they draw on. */
export default async function CvlClientPage({ params }: Props) {
  const { id } = await params
  return ClientDetailView({ id, mode: 'cvl' })
}
