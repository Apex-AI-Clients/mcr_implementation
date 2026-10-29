import { DirectorPenaltyNoticesView } from './view'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
}

/** The client's director penalty notices (view.tsx). In the SBR workspace. */
export default async function DirectorPenaltyNoticesPage({ params }: Props) {
  const { id } = await params
  return DirectorPenaltyNoticesView({ id, workspace: 'sbr' })
}
