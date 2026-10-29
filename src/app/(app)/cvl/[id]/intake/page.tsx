import { ClientIntakeView } from '@/app/(app)/clients/[id]/intake/view'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
}

/** The intake form: client, company and accountant details (view.tsx). In the CVL workspace: the same page as SBR's, for a CVL client file. */
export default async function ClientIntakePage({ params }: Props) {
  const { id } = await params
  return ClientIntakeView({ id, workspace: 'cvl' })
}
