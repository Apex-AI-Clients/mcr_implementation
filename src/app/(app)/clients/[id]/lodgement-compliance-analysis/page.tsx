import { LodgementAnalysisView } from './view'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
}

/** The activity statement's lodgement analysis (view.tsx). In the SBR workspace. */
export default async function LodgementAnalysisPage({ params }: Props) {
  const { id } = await params
  return LodgementAnalysisView({ id, workspace: 'sbr' })
}
