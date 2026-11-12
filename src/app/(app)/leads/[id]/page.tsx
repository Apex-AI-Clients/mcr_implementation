import { LeadRecordClient } from '@/components/leads/LeadRecordClient'
import {
  getActivitiesForLead,
  getClientFilesForLead,
  getLeadById,
  getSubmissionsForLead,
} from '@/lib/leads/queries'
import { getFacebookFormHealth } from '@/lib/leads/formHealth'

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
 *
 * A converted lead also shows what its client files hold — the ABN, ACN and
 * the rest collected at conversion and in intake — so those are read here too:
 * one file per converted enquiry (0052).
 *
 * So is every enquiry the lead has made (lead_submissions), for the Lead history
 * list: the lead row shows only the newest values.
 */
export default async function LeadRecordPage({ params }: Props) {
  const { id } = await params
  const [lead, activities, enquiries] = await Promise.all([
    getLeadById(id),
    getActivitiesForLead(id),
    getSubmissionsForLead(id),
  ])
  const [clientFiles, formWarnings] = await Promise.all([
    getClientFilesForLead(lead, enquiries),
    // Only for the Facebook forms this lead came through; never throws.
    getFacebookFormHealth(
      enquiries.filter((e) => e.source === 'facebook' && e.metaFormId).map((e) => e.metaFormId as string),
    ),
  ])

  return (
    <LeadRecordClient
      leadId={id}
      initialLead={lead}
      initialActivities={activities}
      enquiries={enquiries}
      clientFiles={clientFiles}
      formWarnings={formWarnings}
    />
  )
}
