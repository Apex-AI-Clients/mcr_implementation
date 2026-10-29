import { AtoAccountView } from './view'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string; analysisId: string }>
}

/** An income tax or super guarantee account's summary (view.tsx). In the SBR workspace. */
export default async function AtoAccountPage({ params }: Props) {
  const { id, analysisId } = await params
  return AtoAccountView({ id, analysisId, workspace: 'sbr' })
}
