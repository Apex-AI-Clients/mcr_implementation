'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowRight, Check, Pencil, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { useLeads } from '@/components/leads/LeadsStore'
import { LeadRecordHeader } from '@/components/leads/LeadRecordHeader'
import { LeadActivityForm } from '@/components/leads/LeadActivityForm'
import { LeadHistory } from '@/components/leads/LeadHistory'
import { StageSelect } from '@/components/leads/StageSelect'
import { ConvertToClientDialog } from '@/components/leads/ConvertToClientDialog'
import { DeleteLeadsDialog } from '@/components/leads/DeleteLeadsDialog'
import { Select } from '@/components/ui/Select'
import { ALL_ENTITY_TYPES, ENTITY_TYPE_META } from '@/lib/leads/constants'
import {
  debtSelectOptions,
  decodeDebtRange,
  describeUncertainState,
  formatAge,
  formatDebtRange,
  formatPhone,
  isValidAuMobile,
  isValidEmail,
} from '@/lib/leads/format'
import type { EntityType, Lead, LeadActivity } from '@/types/leads'

interface LeadRecordClientProps {
  leadId: string
  /** Read server-side. Null when no such lead exists in the database. */
  initialLead: Lead | null
  initialActivities: LeadActivity[]
}

export function LeadRecordClient({
  leadId,
  initialLead,
  initialActivities,
}: LeadRecordClientProps) {
  const router = useRouter()
  const { getLead, activitiesFor, syncFromServer } = useLeads()
  const [convertTarget, setConvertTarget] = useState<Lead | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)

  // Hand the server's copy to the store, so edits made here apply to it and
  // survive a move back to the list.
  useEffect(() => {
    if (initialLead) syncFromServer([initialLead], initialActivities)
  }, [initialLead, initialActivities, syncFromServer])

  // Store first: a lead added seconds ago is there before the database read
  // can see it. The server copy covers everything else, including the first
  // render, which happens before the sync effect runs.
  const lead = getLead(leadId) ?? initialLead
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
  const nextStepSetAt = activities.find((activity) => activity.type === 'next_step')?.createdAt
  const uncertainState = describeUncertainState(lead)

  return (
    <div className="mx-auto max-w-6xl p-6">
      <LeadRecordHeader
        lead={lead}
        actions={
          <Button type="button" variant="destructive" size="sm" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="h-4 w-4" />
            Delete
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* Left — history */}
        <div className="space-y-4 lg:order-1">
          <LeadActivityForm leadId={lead.id} />

          {/* The lead's own words — read-only, and the only verbatim record of
              what they asked for. Staff commentary goes in notes. Omitted
              entirely when there is nothing, rather than an empty heading. */}
          {lead.message && (
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-foreground/40">
                Their message
              </p>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-foreground/80">
                {lead.message}
              </p>
            </div>
          )}

          <LeadHistory lead={lead} activities={activities} />
        </div>

        {/* Right — the record */}
        <div className="space-y-4 lg:order-2">
          <div className="space-y-4 rounded-xl border border-border bg-card p-5">
            <InlineSelect
              label="Debt"
              leadId={lead.id}
              value={debtSelectOptions(lead.debtMin, lead.debtMax).value}
              display={formatDebtRange(lead.debtMin, lead.debtMax, 'full')}
              isEmpty={lead.debtMin === null && lead.debtMax === null}
              options={debtSelectOptions(lead.debtMin, lead.debtMax).options}
              patchFor={(value) => {
                const { min, max } = decodeDebtRange(value)
                return { debtMin: min, debtMax: max }
              }}
            />
            {/* A grouping reads "One of NSW, VIC, ACT, TAS"; an answer that did
                not resolve reads "State as given: …". Same style as a state. */}
            <p className="text-xs text-foreground/40">
              {uncertainState ? uncertainState.description : (lead.state ?? 'State not given')}
            </p>
          </div>

          <div className="rounded-xl border border-border bg-card p-5">
            <InlineSelect
              label="Business type"
              leadId={lead.id}
              value={lead.entityType ?? ''}
              display={
                lead.entityType ? ENTITY_TYPE_META[lead.entityType].label : '—'
              }
              isEmpty={lead.entityType === null}
              emptyLabel="Not given"
              size="sm"
              options={ALL_ENTITY_TYPES.map((type) => ({
                value: type,
                label: ENTITY_TYPE_META[type].label,
              }))}
              patchFor={(value) => ({ entityType: (value || null) as EntityType | null })}
            />
            {lead.entityType === 'trust' && (
              <p className="mt-2 text-xs text-warning">
                A trust cannot take the SBR path.
              </p>
            )}
          </div>

          {/* Read-only, like the message — the lead's own words, and free text
              the form required of them. */}
          {lead.preferredCallTime && (
            <div className="rounded-xl border border-border bg-card p-5">
              <p className="text-xs font-medium uppercase tracking-wide text-foreground/40">
                Preferred call time
              </p>
              <p className="mt-1.5 text-sm text-foreground/80">{lead.preferredCallTime}</p>
            </div>
          )}

          <div className="rounded-xl border border-border bg-card p-5">
            <p className="mb-3 text-xs font-medium uppercase tracking-wide text-foreground/40">
              Stage
            </p>
            <StageSelect
              lead={lead}
              onRequestConvert={setConvertTarget}
              selectSize="md"
              className="w-full"
            />
            <p className="mt-2 text-xs text-foreground/40">
              In this stage since {formatAge(lead.stageSince).toLowerCase()}
            </p>
          </div>

          <div className="space-y-3 rounded-xl border border-border bg-card p-5">
            <p className="text-xs font-medium uppercase tracking-wide text-foreground/40">
              Contact
            </p>
            <InlineField
              label="Email"
              value={lead.email}
              leadId={lead.id}
              field="email"
              validate={(value) =>
                isValidEmail(value) ? null : 'That email address does not look right.'
              }
            />
            <InlineField
              label="Phone"
              value={lead.phone}
              display={formatPhone(lead.phone)}
              leadId={lead.id}
              field="phone"
              validate={(value) =>
                isValidAuMobile(value) ? null : 'Enter an Australian mobile.'
              }
            />
            <InlineField
              label="Company"
              value={lead.company ?? ''}
              placeholder="Not recorded"
              leadId={lead.id}
              field="company"
              allowEmpty
            />
          </div>

          <div className="rounded-xl border border-border bg-card p-5">
            <p className="text-xs font-medium uppercase tracking-wide text-foreground/40">
              Next step
            </p>
            {lead.nextStep ? (
              <>
                <p className="mt-1.5 text-sm leading-relaxed text-foreground/80">
                  {lead.nextStep}
                </p>
                {nextStepSetAt && (
                  <p className="mt-1.5 text-xs text-foreground/40">
                    Set {formatAge(nextStepSetAt).toLowerCase()}
                  </p>
                )}
              </>
            ) : (
              <p className="mt-1.5 text-sm text-foreground/40">
                None set. Use the composer to add one.
              </p>
            )}
          </div>

          <ConversionPanel lead={lead} onConvert={() => setConvertTarget(lead)} />
        </div>
      </div>

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

/** The join between the two halves of the product. Reads as a destination. */
function ConversionPanel({ lead, onConvert }: { lead: Lead; onConvert: () => void }) {
  if (lead.convertedClientId) {
    return (
      <div className="rounded-xl border border-success/30 bg-success/5 p-5">
        <p className="text-sm font-semibold text-foreground">Client file created</p>
        <p className="mt-1.5 text-sm leading-relaxed text-foreground/60">
          {lead.name} has a file in the restructuring workspace.
        </p>
        <Link
          href={`/clients/${lead.convertedClientId}`}
          className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline"
        >
          Open their client file
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>
    )
  }

  // A lead can sit at a converted stage with no file behind it — an imported
  // sheet row, or a conversion whose lead update failed. Say so rather than
  // pretending it was never converted.
  const markedButUnlinked = lead.stage === 'converted' || lead.stage === 'client'

  return (
    <div className="rounded-xl border border-accent/30 bg-accent/5 p-5">
      <p className="text-sm font-semibold text-foreground">Convert to client</p>
      <p className="mt-1.5 text-sm leading-relaxed text-foreground/60">
        {markedButUnlinked
          ? 'This lead is marked converted but has no client file linked. Creating one joins it to the restructuring workspace.'
          : 'Converting this lead to Client creates their file in the platform.'}
      </p>
      <Button type="button" className="mt-4 w-full" onClick={onConvert}>
        {markedButUnlinked ? 'Create their client file' : 'Convert to client'}
      </Button>
    </div>
  )
}

interface InlineSelectProps {
  label: string
  /** Stored value as a select value; '' means nothing chosen. */
  value: string
  /** Formatted value shown when not editing. */
  display: string
  /** Drives the muted treatment — the display string may legitimately be an em dash. */
  isEmpty: boolean
  /** Leading option that clears the field. Omit when the option list carries its own. */
  emptyLabel?: string
  options: { value: string; label: string }[]
  leadId: string
  /** Maps the chosen value to the Lead patch to dispatch. */
  patchFor: (value: string) => Partial<Lead>
  size?: 'sm' | 'lg'
}

/**
 * Sibling to InlineField for values that come from a fixed set. Same
 * begin/save/cancel shape, same UPDATE_LEAD dispatch — Enter saves, Escape
 * cancels.
 *
 * Correcting one of these is a data correction, not contact: UPDATE_LEAD
 * deliberately leaves `lastActionAt` alone and writes no activity. Only the four
 * composer types and stage changes touch the clock.
 */
function InlineSelect({
  label,
  value,
  display,
  isEmpty,
  emptyLabel,
  options,
  leadId,
  patchFor,
  size = 'lg',
}: InlineSelectProps) {
  const { updateLead } = useLeads()
  const { toast } = useToast()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)

  function begin() {
    setDraft(value)
    setEditing(true)
  }

  function save() {
    updateLead(leadId, patchFor(draft))
    setEditing(false)
    toast(`${label} updated.`)
  }

  const fieldId = `inline-${label.toLowerCase().replace(/\s+/g, '-')}`

  if (editing) {
    return (
      <div>
        <label
          htmlFor={fieldId}
          className="text-xs font-medium uppercase tracking-wide text-foreground/40"
        >
          {label}
        </label>
        <div className="mt-2 flex items-start gap-1.5">
          <Select
            id={fieldId}
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                save()
              } else if (event.key === 'Escape') {
                event.preventDefault()
                setEditing(false)
              }
            }}
            placeholder={emptyLabel}
            options={options}
          />
          <button
            type="button"
            onClick={save}
            aria-label={`Save ${label.toLowerCase()}`}
            className="mt-0.5 rounded-lg p-1.5 text-success transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Check className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            aria-label={`Cancel editing ${label.toLowerCase()}`}
            className="mt-0.5 rounded-lg p-1.5 text-muted transition-colors hover:bg-surface hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="group flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-foreground/40">{label}</p>
        <p
          className={`${size === 'lg' ? 'mt-1 text-2xl font-bold tabular-nums' : 'mt-1.5 text-sm'} ${
            isEmpty ? 'text-foreground/40' : 'text-foreground'
          }`}
        >
          {display}
        </p>
      </div>
      <button
        type="button"
        onClick={begin}
        aria-label={`Edit ${label.toLowerCase()}`}
        className="shrink-0 rounded-lg p-1.5 text-muted opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent group-hover:opacity-100"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

interface InlineFieldProps {
  label: string
  /** Raw stored value — what the input starts from. */
  value: string
  /** Formatted value for display, when it differs from the raw value. */
  display?: string
  placeholder?: string
  leadId: string
  field: 'email' | 'phone' | 'company'
  allowEmpty?: boolean
  validate?: (value: string) => string | null
}

/**
 * Click the pencil to edit in place. Enter saves, Escape cancels.
 *
 * Editing a contact field does not reset the follow-up clock — correcting a
 * phone number is not evidence that anyone contacted the lead.
 */
function InlineField({
  label,
  value,
  display,
  placeholder,
  leadId,
  field,
  allowEmpty = false,
  validate,
}: InlineFieldProps) {
  const { updateLead } = useLeads()
  const { toast } = useToast()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [error, setError] = useState<string | null>(null)

  function begin() {
    setDraft(value)
    setError(null)
    setEditing(true)
  }

  function cancel() {
    setEditing(false)
    setError(null)
  }

  function save() {
    const trimmed = draft.trim()
    if (!trimmed && !allowEmpty) {
      setError(`${label} cannot be empty.`)
      return
    }
    if (trimmed && validate) {
      const message = validate(trimmed)
      if (message) {
        setError(message)
        return
      }
    }
    updateLead(leadId, { [field]: field === 'company' && !trimmed ? null : trimmed })
    setEditing(false)
    setError(null)
    toast(`${label} updated.`)
  }

  if (editing) {
    return (
      <div>
        <label htmlFor={`${field}-input`} className="text-xs font-medium text-muted">
          {label}
        </label>
        <div className="mt-1 flex items-start gap-1.5">
          <div className="flex-1">
            <input
              id={`${field}-input`}
              autoFocus
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  save()
                } else if (event.key === 'Escape') {
                  event.preventDefault()
                  cancel()
                }
              }}
              className="h-8 w-full rounded-lg border border-border bg-input-bg px-2.5 text-sm text-foreground transition-colors focus:border-accent focus:outline-none"
            />
            {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
          </div>
          <button
            type="button"
            onClick={save}
            aria-label={`Save ${label.toLowerCase()}`}
            className="rounded-lg p-1.5 text-success transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Check className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={cancel}
            aria-label={`Cancel editing ${label.toLowerCase()}`}
            className="rounded-lg p-1.5 text-muted transition-colors hover:bg-surface hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="group flex items-baseline justify-between gap-3">
      <div className="min-w-0">
        <p className="text-xs text-muted">{label}</p>
        <p
          className={`mt-0.5 truncate text-sm ${
            value ? 'text-foreground' : 'text-foreground/40'
          }`}
        >
          {value ? (display ?? value) : (placeholder ?? '—')}
        </p>
      </div>
      <button
        type="button"
        onClick={begin}
        aria-label={`Edit ${label.toLowerCase()}`}
        className="shrink-0 rounded-lg p-1.5 text-muted opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent group-hover:opacity-100"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
