import { LeadRecordClient } from '@/components/leads/LeadRecordClient'
import { safeLeadsReturn } from '@/lib/leads/constants'
import {
  getActivitiesForLead,
  getClientFilesForLead,
  getLeadById,
  getSubmissionsForLead,
} from '@/lib/leads/queries'
import { after } from 'next/server'
import { getFacebookFormHealth, getWebsiteFormHealth } from '@/lib/leads/formHealth'
import { raiseDeveloperAlert } from '@/lib/alerts/developerAlert'
import { getSupabaseServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
  /** `from`: the list the record was opened from, for "All leads" (constants.ts safeLeadsReturn). */
  searchParams?: Promise<{ from?: string }>
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
export default async function LeadRecordPage({ params, searchParams }: Props) {
  const { id } = await params
  const backHref = safeLeadsReturn((await searchParams)?.from ?? null) ?? '/leads'
  const [lead, activities, enquiries] = await Promise.all([
    getLeadById(id),
    getActivitiesForLead(id),
    getSubmissionsForLead(id),
  ])
  const [clientFiles, facebookWarnings, websiteWarnings] = await Promise.all([
    getClientFilesForLead(lead, enquiries),
    // Only for the forms this lead came through; neither throws.
    getFacebookFormHealth(
      enquiries.filter((e) => e.source === 'facebook' && e.metaFormId).map((e) => e.metaFormId as string),
    ),
    // Website enquiries with no form id are checked together, as 'unknown' (0053).
    getWebsiteFormHealth(enquiries.filter((e) => e.source === 'website').map((e) => e.metaFormId ?? 'unknown')),
  ])
  // A form sending something the CRM cannot read is the developer's to fix, never a warning on
  // Gabby's screen (24 Nov 2026): each goes to the developer alert, once while it is open. Form ids
  // and question names only. After the page is sent, so it never waits on the email.
  const formWarnings = [...facebookWarnings, ...websiteWarnings]
  if (formWarnings.length) {
    after(async () => {
      const supabase = getSupabaseServerClient()
      for (const warning of formWarnings) {
        await raiseDeveloperAlert(supabase, {
          kind: 'lead_form',
          key: `lead_form:${warning}`.slice(0, 500),
          subject: 'Lead form check: a form needs a field map change',
          lines: [warning, '', `Seen on lead id: ${id}`],
        })
      }
    })
  }

  return (
    <LeadRecordClient
      leadId={id}
      initialLead={lead}
      initialActivities={activities}
      enquiries={enquiries}
      clientFiles={clientFiles}
      backHref={backHref}
    />
  )
}
