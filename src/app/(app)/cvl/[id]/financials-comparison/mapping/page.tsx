import { LineMappingView } from '@/app/(app)/clients/[id]/financials-comparison/mapping/view'

// Scanned pages are read in the background after the response (src/lib/scan, after()).
export const maxDuration = 800

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
}

/** Which printed lines mean what, confirmed by staff (view.tsx). In the CVL workspace: the same page as SBR's, for a CVL client file. */
export default async function LineMappingPage({ params }: Props) {
  const { id } = await params
  return LineMappingView({ id, workspace: 'cvl' })
}
