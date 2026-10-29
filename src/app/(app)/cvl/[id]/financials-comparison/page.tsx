import { FinancialsComparisonView } from '@/app/(app)/clients/[id]/financials-comparison/view'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
  /** earlier=1: also the years printed only as a comparative column. */
  searchParams: Promise<{ earlier?: string }>
}

/** The client's financial statements exactly as printed, years side by side (view.tsx). In the CVL workspace: the same page as SBR's, for a CVL client file. */
export default async function FinancialsComparisonPage({ params, searchParams }: Props) {
  const { id } = await params
  return FinancialsComparisonView({ id, workspace: 'cvl', earlierYears: (await searchParams).earlier === '1' })
}
