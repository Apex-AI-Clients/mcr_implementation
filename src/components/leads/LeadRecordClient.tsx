'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { describeDirector } from '@/lib/asic/fill'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  ArrowRight,
  Clock,
  Copy,
  Mail,
  Pencil,
  Phone,
  Trash2,
  type LucideIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { useLeads } from '@/components/leads/LeadsStore'
import { LeadRecordHeader } from '@/components/leads/LeadRecordHeader'
import { LeadActivityForm } from '@/components/leads/LeadActivityForm'
import { LeadActivityTimeline } from '@/components/leads/LeadActivityTimeline'
import { LeadEnquiries } from '@/components/leads/LeadEnquiries'
import { StageProgress } from '@/components/leads/StageProgress'
import { StageSelect } from '@/components/leads/StageSelect'
import { ConvertToClientDialog } from '@/components/leads/ConvertToClientDialog'
import { DeleteLeadsDialog } from '@/components/leads/DeleteLeadsDialog'
import { EditLeadDialog } from '@/components/leads/EditLeadDialog'
import { identityDisplay } from '@/lib/clients/identityDisplay'
import { clientHref } from '@/lib/clients/archive'
import { reenquiryMarkerLabel, showsReenquiryMarker } from '@/lib/leads/enquiries'
import {
  describeUncertainState,
  formatAge,
  formatDebtRange,
  formatEntityType,
  formatFullDate,
  formatPhone,
} from '@/lib/leads/format'
import type { ConvertedClientDetails, Lead, LeadActivity, LeadSubmission } from '@/types/leads'

interface LeadRecordClientProps {
  leadId: string
  /** Read server-side. Null when no such lead exists in the database. */
  initialLead: Lead | null
  initialActivities: LeadActivity[]
  /** Every enquiry, newest first, read server-side. */
  enquiries: LeadSubmission[]
  /** The client file this lead became, read server-side. Null when not converted. */
  convertedClient: ConvertedClientDetails | null
}

/**
 * The lead record, laid out to be read top to bottom:
 *
 *  1. Who it is, with Edit and Delete.
 *  2. Where they have got to: the stage track, the stage control and the
 *     convert action together, so moving a lead on happens in one place.
 *  3. The four facts that decide what happens next: debt, state, business
 *     type and the next step.
 *  4. Activity on the left (log something, then everything logged, newest
 *     first); how to reach them, what they said, and every enquiry on the right.
 *
 * Details change in one place, the Edit dialog. Stage is the exception: moving
 * a lead on is an action that is logged, not a correction.
 */
export function LeadRecordClient({
  leadId,
  initialLead,
  initialActivities,
  enquiries,
  convertedClient,
}: LeadRecordClientProps) {
  const router = useRouter()
  const { getLead, activitiesFor, syncFromServer, dismissReenquiry } = useLeads()
  const [convertTarget, setConvertTarget] = useState<Lead | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)

  // Hand the server's copy to the store, so edits made here apply to it and
  // survive a move back to the list.
  useEffect(() => {
    if (initialLead) syncFromServer([initialLead], initialActivities)
  }, [initialLead, initialActivities, syncFromServer])

  // Store first: a lead added seconds ago is there before the database read
  // can see it. The server copy covers everything else, including the first
  // render, which happens before the sync effect runs.
  const lead = getLead(leadId) ?? initialLead

  // Converting happens in a dialog on this page and only updates the store, so
  // the client file's details were never read. Re-read the page once for each
  // newly linked file — once, so a file that cannot be read cannot loop.
  const linkedClientId = lead?.convertedClientId ?? null
  const refreshedFor = useRef<string | null>(null)
  useEffect(() => {
    if (!linkedClientId || linkedClientId === convertedClient?.id) return
    if (refreshedFor.current === linkedClientId) return
    refreshedFor.current = linkedClientId
    router.refresh()
  }, [linkedClientId, convertedClient?.id, router])

  if (!lead) {
    return (
      <div className="mx-auto max-w-6xl p-6">
        <div className="rounded-xl border border-dashed border-border py-16 text-center">
          <p className="text-sm text-foreground/50">That lead no longer exists.</p>
          <Link href="/leads" className="mt-3 inline-block text-sm text-accent hover:underline">
            Back to all leads
          </Link>
        </div>
      </div>
    )
  }

  const activities = activitiesFor(lead.id)

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <LeadRecordHeader
        lead={lead}
        actions={
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setEditOpen(true)}>
              <Pencil className="h-4 w-4" />
              Edit
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </Button>
          </div>
        }
      />

      {showsReenquiryMarker(lead) && (
        <ReenquiryNotice lead={lead} onDismiss={() => dismissReenquiry(lead.id)} />
      )}

      <ProgressCard lead={lead} onConvert={() => setConvertTarget(lead)} />

      <KeyFacts lead={lead} activities={activities} />

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* Activity — log something, then everything logged. One list, newest
            first: stage changes sit among the calls and notes that led to
            them, so the story reads in order. */}
        <section aria-labelledby="lead-activity-heading" className="min-w-0 space-y-3">
          <SectionHeading id="lead-activity-heading" count={activities.length}>
            Activity
          </SectionHeading>
          <LeadActivityForm leadId={lead.id} />
          <LeadActivityTimeline activities={activities} editable />
        </section>

        <div className="min-w-0 space-y-4">
          <ContactCard lead={lead} />

          {convertedClient && convertedClient.id === lead.convertedClientId && (
            <ClientFileDetails client={convertedClient} />
          )}

          <LeadEnquiries lead={lead} enquiries={enquiries} />
        </div>
      </div>

      {/* Mounted only while open, so it prefills from the lead as it is now. */}
      {editOpen && <EditLeadDialog lead={lead} onClose={() => setEditOpen(false)} />}
      <ConvertToClientDialog lead={convertTarget} onClose={() => setConvertTarget(null)} />
      <DeleteLeadsDialog
        leads={deleteOpen ? [lead] : null}
        onClose={() => setDeleteOpen(false)}
        onDeleted={() => {
          // The record this page is built on no longer exists, so staying put
          // would render the "no longer exists" state at a URL that used to
          // work. Back to the list, refreshed so it re-reads without the row.
          router.push('/leads')
          router.refresh()
        }}
      />
    </div>
  )
}

function SectionHeading({
  id,
  count,
  children,
}: {
  id: string
  count?: number
  children: ReactNode
}) {
  return (
    <h2 id={id} className="flex items-baseline gap-2 text-sm font-semibold text-foreground">
      {children}
      {count !== undefined && count > 0 && (
        <span className="text-xs font-normal tabular-nums text-foreground/40">{count}</span>
      )}
    </h2>
  )
}

/**
 * Where the lead has got to, and the controls that move it on. The convert
 * action sits here rather than at the bottom of a column, because it is the
 * step the track leads to.
 */
function ProgressCard({ lead, onConvert }: { lead: Lead; onConvert: () => void }) {
  return (
    <section
      aria-label="Progress"
      className="mb-6 rounded-xl border border-border bg-card p-4 sm:p-5"
    >
      <StageProgress lead={lead} embedded />
      <div className="mt-5 flex flex-wrap items-end justify-between gap-4 border-t border-border pt-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="text-xs font-medium text-muted">Stage</span>
          <div className="w-52">
            <StageSelect
              lead={lead}
              onRequestConvert={onConvert}
              selectSize="md"
              className="w-full"
            />
          </div>
          <span className="text-xs text-foreground/40">
            Since {formatAge(lead.stageSince).toLowerCase()}
          </span>
        </div>
        <ConvertAction lead={lead} onConvert={onConvert} />
      </div>
    </section>
  )
}

/** The join between the two halves of the product. */
function ConvertAction({ lead, onConvert }: { lead: Lead; onConvert: () => void }) {
  if (lead.convertedClientId) {
    return (
      <Link
        href={`/clients/${lead.convertedClientId}`}
        className="inline-flex items-center gap-1.5 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm font-medium text-success transition-colors hover:bg-success/15"
      >
        Open their client file
        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
      </Link>
    )
  }

  // A lead can sit at a converted stage with no file behind it — an imported
  // sheet row, or a conversion whose lead update failed. Say so rather than
  // pretending it was never converted.
  const markedButUnlinked = lead.stage === 'converted' || lead.stage === 'client'

  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <Button type="button" onClick={onConvert}>
        {markedButUnlinked ? 'Create their client file' : 'Convert to client'}
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Button>
      <p className="text-xs text-foreground/40">
        {markedButUnlinked
          ? 'Marked converted, but no client file is linked.'
          : 'Creates their file in the restructuring workspace.'}
      </p>
    </div>
  )
}

/**
 * The four facts that decide what happens next, as tiles. Each says plainly
 * when nothing is known.
 */
function KeyFacts({ lead, activities }: { lead: Lead; activities: LeadActivity[] }) {
  const uncertainState = describeUncertainState(lead)
  const entityType = formatEntityType(lead)
  const hasDebt = lead.debtMin !== null || lead.debtMax !== null
  const nextStepSetAt = activities.find((activity) => activity.type === 'next_step')?.createdAt

  return (
    <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <FactTile label="Debt" empty={!hasDebt} large>
        {hasDebt ? formatDebtRange(lead.debtMin, lead.debtMax, 'full') : 'Not given'}
      </FactTile>
      <FactTile
        label="State"
        empty={!lead.state && !uncertainState}
        hint={uncertainState?.description}
        large
      >
        {uncertainState ? uncertainState.label : (lead.state ?? 'Not given')}
      </FactTile>
      <FactTile
        label="Business type"
        empty={entityType === null}
        hint={
          lead.entityType === 'trust' && !lead.entityTypeLabel ? (
            <span className="text-warning">A trust cannot take the SBR path.</span>
          ) : undefined
        }
        large
      >
        {entityType ?? 'Not given'}
      </FactTile>
      <FactTile
        label="Next step"
        empty={!lead.nextStep}
        hint={
          lead.nextStep
            ? nextStepSetAt && `Set ${formatAge(nextStepSetAt).toLowerCase()}`
            : 'Add one under Activity.'
        }
      >
        {lead.nextStep ?? 'None set'}
      </FactTile>
    </dl>
  )
}

function FactTile({
  label,
  empty,
  hint,
  large = false,
  children,
}: {
  label: string
  empty: boolean
  hint?: ReactNode
  large?: boolean
  children: ReactNode
}) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-card p-4">
      <dt className="text-xs font-medium text-muted">{label}</dt>
      <dd
        className={`mt-1 break-words ${
          large ? 'text-lg font-semibold tabular-nums' : 'line-clamp-3 text-sm font-medium'
        } ${empty ? 'text-foreground/35' : 'text-foreground'}`}
      >
        {children}
      </dd>
      {hint && <dd className="mt-1 text-xs text-foreground/40">{hint}</dd>}
    </div>
  )
}

/**
 * How to reach them and what they asked for, in one card. Email and phone are
 * links (mailto, tel) with a copy button each, because ringing or emailing is
 * what someone opens this page to do.
 */
function ContactCard({ lead }: { lead: Lead }) {
  return (
    <section
      aria-labelledby="lead-contact-heading"
      className="rounded-xl border border-border bg-card p-4"
    >
      <SectionHeading id="lead-contact-heading">Contact</SectionHeading>
      <ul className="mt-3 space-y-2.5">
        <ContactRow icon={Mail} label="Email" copy={lead.email}>
          <a href={`mailto:${lead.email}`} className="truncate text-accent hover:underline">
            {lead.email}
          </a>
        </ContactRow>
        <ContactRow icon={Phone} label="Phone" copy={lead.phone}>
          <a href={`tel:${lead.phone}`} className="min-w-0 tabular-nums text-accent wrap-anywhere hover:underline">
            {formatPhone(lead.phone)}
          </a>
        </ContactRow>
        {lead.preferredCallTime && (
          <ContactRow icon={Clock} label="Best time to call">
            <span className="text-foreground/80">{lead.preferredCallTime}</span>
          </ContactRow>
        )}
      </ul>

      {/* The lead's own words, and the only verbatim record of what they asked
          for. Staff commentary goes in Activity. */}
      {lead.message && (
        <div className="mt-4 border-t border-border pt-4">
          <p className="text-xs font-medium text-muted">Their message</p>
          <blockquote className="mt-2 whitespace-pre-wrap wrap-anywhere border-l-2 border-accent/40 pl-3 text-sm leading-relaxed text-foreground/80">
            {lead.message}
          </blockquote>
        </div>
      )}
    </section>
  )
}

function ContactRow({
  icon: Icon,
  label,
  copy,
  children,
}: {
  icon: LucideIcon
  label: string
  /** Text the copy button puts on the clipboard. No button when absent. */
  copy?: string
  children: ReactNode
}) {
  const { toast } = useToast()

  async function handleCopy() {
    if (!copy) return
    try {
      await navigator.clipboard.writeText(copy)
      toast(`${label} copied.`)
    } catch {
      toast(`Could not copy the ${label.toLowerCase()}.`, { tone: 'error' })
    }
  }

  return (
    <li className="flex items-center gap-3 text-sm">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface">
        <Icon className="h-4 w-4 text-muted" aria-hidden="true" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-xs text-foreground/40">{label}</span>
        <span className="flex min-w-0">{children}</span>
      </div>
      {copy && (
        <button
          type="button"
          onClick={handleCopy}
          aria-label={`Copy ${label.toLowerCase()}`}
          className="shrink-0 rounded-lg p-1.5 text-muted transition-colors hover:bg-surface hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
      )}
    </li>
  )
}

/**
 * A converted or closed lead has enquired again. Its stage and details were
 * left alone — the enquiry is in the list below — so this is the prompt to
 * look. Changing the stage clears it; Dismiss hides it without changing
 * anything, and is not a logged action, so the follow-up clock does not move.
 */
function ReenquiryNotice({ lead, onDismiss }: { lead: Lead; onDismiss: () => void }) {
  return (
    <div
      role="status"
      className="mb-6 flex flex-wrap items-start justify-between gap-3 rounded-xl border border-warning/30 bg-warning/10 p-4"
    >
      <div className="flex min-w-0 items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
        <div className="text-sm leading-relaxed text-foreground/80">
          <p className="font-medium text-foreground">{reenquiryMarkerLabel(lead)}</p>
          <p>
            {lead.name} enquired again on {formatFullDate(lead.reenquiredAfterCloseAt!)}. The
            stage and details were left as they were; the new enquiry is under Lead history.
            Changing the stage also clears this.
          </p>
        </div>
      </div>
      <Button type="button" variant="ghost" size="sm" onClick={onDismiss}>
        Dismiss
      </Button>
    </div>
  )
}

type DetailRow = { label: string; value: string | null; numeric?: boolean }

function recordedOnly(rows: DetailRow[]): DetailRow[] {
  return rows.filter((row) => row.value && row.value.trim())
}

/**
 * What the client file holds, read-only: the details typed at conversion and
 * anything added in intake since. Only what is actually recorded is listed.
 * The company and the trust are their own groups, each with its own ABN — a
 * trustee company with no ABN says "No ABN of its own" rather than leaving a
 * gap. Edited on the client file, which the link opens.
 */
function ClientFileDetails({ client }: { client: ConvertedClientDetails }) {
  const contact = recordedOnly([
    { label: 'Name', value: client.name },
    { label: 'Email', value: client.email },
    { label: 'Phone', value: client.phone ? formatPhone(client.phone) : null, numeric: true },
  ])
  const identity = identityDisplay(client)
  const company = recordedOnly([
    ...identity.company,
    {
      label: 'Company phone',
      value: client.companyPhone ? formatPhone(client.companyPhone) : null,
      numeric: true,
    },
    { label: 'Company email', value: client.companyEmail },
    { label: 'Registered office', value: client.registeredOfficeAddress },
    { label: 'Principal place of business', value: client.principalPlaceOfBusiness },
  ])
  const trust = identity.trust ? recordedOnly(identity.trust) : []

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-foreground/40">
          Client file
          {client.archivedAt && (
            <span className="ml-2 normal-case tracking-normal text-warning">Archived</span>
          )}
        </p>
        <Link
          href={clientHref(client)}
          className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
        >
          Open
          <ArrowRight className="h-3 w-3" aria-hidden="true" />
        </Link>
      </div>
      <div className="space-y-2.5">
        <dl className="space-y-2.5">
          <DetailRows rows={contact} />
        </dl>
        {(company.length > 0 || client.directors.length > 0) && (
          <DetailGroup heading="Company">
            <DetailRows rows={company} />
            {/* Their own entry, under the company: the directors are not the
                lead, whose name is the "Name" row above and stays as it came in. */}
            {client.directors.length > 0 && (
              <div>
                <dt className="text-xs text-foreground/40">
                  {client.directors.length > 1 ? 'Directors' : 'Director'}
                </dt>
                <dd className="mt-0.5 space-y-0.5 text-sm text-foreground/80">
                  {client.directors.map((director, index) => (
                    <p key={index} className="break-words tabular-nums">
                      {describeDirector(director)}
                    </p>
                  ))}
                </dd>
              </div>
            )}
          </DetailGroup>
        )}
        {trust.length > 0 && (
          <DetailGroup heading="Trust">
            <DetailRows rows={trust} />
          </DetailGroup>
        )}
      </div>
    </div>
  )
}

function DetailGroup({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section aria-label={heading} className="space-y-2.5 border-t border-border pt-2.5">
      <h3 className="text-[11px] font-medium uppercase tracking-wide text-foreground/40">
        {heading}
      </h3>
      <dl className="space-y-2.5">{children}</dl>
    </section>
  )
}

function DetailRows({ rows }: { rows: DetailRow[] }) {
  return rows.map((row) => (
    <div key={row.label}>
      <dt className="text-xs text-foreground/40">{row.label}</dt>
      <dd
        className={`mt-0.5 break-words text-sm text-foreground/80 ${
          row.numeric ? 'tabular-nums' : ''
        }`}
      >
        {row.value}
      </dd>
    </div>
  ))
}
