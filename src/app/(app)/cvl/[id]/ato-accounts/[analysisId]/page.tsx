import { AtoAccountView } from '@/app/(app)/clients/[id]/ato-accounts/[analysisId]/view'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string; analysisId: string }>
}

/** An income tax or super guarantee account's summary (view.tsx). In the CVL workspace: the same page as SBR's, for a CVL client file. */
export default async function AtoAccountPage({ params }: Props) {
  const { id, analysisId } = await params
  return AtoAccountView({ id, analysisId, workspace: 'cvl' })
}
