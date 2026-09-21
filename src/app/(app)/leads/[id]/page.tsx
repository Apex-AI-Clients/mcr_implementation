import { LeadRecordClient } from '@/components/leads/LeadRecordClient'
import { getActivitiesForLead, getLeadById } from '@/lib/leads/queries'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
}

/**
 * Lead record.
 *
 * Read here rather than pulled out of the client store: the store now holds
 * only what the list last showed, so a lead on page 7 — or one opened from a
 * bookmark — would not be in it.
 *
 * A miss is passed through as null instead of calling notFound(). The store is
 * still consulted first on the client, which is what lets a lead created
 * moments ago open before its insert has come back.
 */
export default async function LeadRecordPage({ params }: Props) {
  const { id } = await params
  const [lead, activities] = await Promise.all([getLeadById(id), getActivitiesForLead(id)])

  return <LeadRecordClient leadId={id} initialLead={lead} initialActivities={activities} />
}
