import { LeadRecordClient } from '@/components/leads/LeadRecordClient'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
}

/**
 * Lead record.
 *
 * The lead is resolved from the client store rather than here, because a lead
 * added during this session exists only in that store — a server-side lookup
 * would 404 on a lead Gabby just created.
 */
export default async function LeadRecordPage({ params }: Props) {
  const { id } = await params
  return <LeadRecordClient leadId={id} />
}
