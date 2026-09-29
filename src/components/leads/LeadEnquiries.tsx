import { Badge } from '@/components/ui/Badge'
import { describeEnquirySource, enquiryFields } from '@/lib/leads/enquiries'
import { formatDateTime, formatFullDate } from '@/lib/leads/format'
import type { Lead, LeadSubmission } from '@/types/leads'

interface LeadEnquiriesProps {
  lead: Pick<Lead, 'reenquiryDismissedAt' | 'reenquiryDismissedBy'>
  /** Newest first, as getSubmissionsForLead returns them. */
  enquiries: LeadSubmission[]
}

/**
 * Every enquiry this person has made, newest first, each with everything it
 * said and where it came from.
 *
 * The lead row above shows the newest values; this is where the history
 * lives, so nothing an earlier form said is lost. A field that differs from
 * the enquiry before it is highlighted, which is how a changed debt or a new
 * phone number stands out without comparing two lists by eye.
 *
 * The newest is open; older ones are collapsed to their date and source, and
 * open with a click or Enter — native <details>, so keyboard and screen
 * readers get the disclosure for free.
 */
export function LeadEnquiries({ lead, enquiries }: LeadEnquiriesProps) {
  if (enquiries.length === 0) return null

  const views = enquiries.map((enquiry, index) => ({
    enquiry,
    fields: enquiryFields(enquiry, enquiries[index + 1]),
  }))
  const anyChanged = views.some((view) => view.fields.some((field) => field.changed))

  return (
    <section
      aria-labelledby="lead-enquiries-heading"
      className="rounded-xl border border-border bg-card p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2
          id="lead-enquiries-heading"
          className="text-xs font-medium uppercase tracking-wide text-foreground/40"
        >
          Enquiries ({enquiries.length})
        </h2>
        {anyChanged && (
          <p className="text-xs text-foreground/40">
            <span className="rounded bg-accent/15 px-1 text-foreground">Highlighted</span> =
            different from the enquiry before
          </p>
        )}
      </div>

      {lead.reenquiryDismissedAt && (
        <p className="mt-1.5 text-xs text-foreground/40">
          &ldquo;New enquiry&rdquo; marker dismissed
          {lead.reenquiryDismissedBy ? ` by ${lead.reenquiryDismissedBy}` : ''},{' '}
          {formatFullDate(lead.reenquiryDismissedAt)}
        </p>
      )}

      <ol className="mt-3 space-y-2">
        {views.map(({ enquiry, fields }, index) => {
          const [source, ...detail] = describeEnquirySource(enquiry)
          return (
            <li key={enquiry.id}>
              <details open={index === 0} className="group rounded-lg border border-border">
                <summary className="flex cursor-pointer flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-sm">
                  <span className="font-medium tabular-nums text-foreground">
                    {formatDateTime(enquiry.receivedAt)}
                  </span>
                  <span className="text-foreground/50">{source}</span>
                  {index === 0 && enquiries.length > 1 && <Badge variant="accent">Latest</Badge>}
                  {enquiry.afterClose && (
                    <Badge variant="warning">After conversion or closure</Badge>
                  )}
                </summary>

                <div className="space-y-2 border-t border-border px-3 pb-3 pt-2">
                  {detail.length > 0 && (
                    <p className="text-xs text-foreground/40">{detail.join(' · ')}</p>
                  )}
                  <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-sm">
                    {fields.map((field) => (
                      <div key={field.label} className="contents">
                        <dt className="text-foreground/40">{field.label}</dt>
                        <dd className="min-w-0 break-words">
                          {field.value === null ? (
                            <span className="text-foreground/30">Not given</span>
                          ) : (
                            <span
                              className={
                                field.changed
                                  ? 'whitespace-pre-wrap rounded bg-accent/15 px-1 text-foreground'
                                  : 'whitespace-pre-wrap text-foreground/80'
                              }
                            >
                              {field.value}
                              {field.changed && (
                                <span className="sr-only"> (changed from the enquiry before)</span>
                              )}
                            </span>
                          )}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </details>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
