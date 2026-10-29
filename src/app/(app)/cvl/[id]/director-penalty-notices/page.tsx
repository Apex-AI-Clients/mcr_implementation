import { DirectorPenaltyNoticesView } from '@/app/(app)/clients/[id]/director-penalty-notices/view'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
}

/** The client's director penalty notices (view.tsx). In the CVL workspace: the same page as SBR's, for a CVL client file. */
export default async function DirectorPenaltyNoticesPage({ params }: Props) {
  const { id } = await params
  return DirectorPenaltyNoticesView({ id, workspace: 'cvl' })
}
