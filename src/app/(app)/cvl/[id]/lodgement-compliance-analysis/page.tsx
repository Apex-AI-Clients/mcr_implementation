import { LodgementAnalysisView } from '@/app/(app)/clients/[id]/lodgement-compliance-analysis/view'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
}

/** The activity statement's lodgement analysis (view.tsx). In the CVL workspace: the same page as SBR's, for a CVL client file. */
export default async function LodgementAnalysisPage({ params }: Props) {
  const { id } = await params
  return LodgementAnalysisView({ id, workspace: 'cvl' })
}
