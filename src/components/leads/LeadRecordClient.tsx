'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Check, Pencil, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { useLeads } from '@/components/leads/LeadsStore'
import { LeadRecordHeader } from '@/components/leads/LeadRecordHeader'
import { LeadActivityForm } from '@/components/leads/LeadActivityForm'
import { LeadActivityTimeline } from '@/components/leads/LeadActivityTimeline'
import { StageSelect } from '@/components/leads/StageSelect'
import { ConvertToClientDialog } from '@/components/leads/ConvertToClientDialog'
import { formatAge, formatDebt, formatPhone, isValidAuMobile, isValidEmail } from '@/lib/leads/format'
import type { Lead } from '@/types/leads'

interface LeadRecordClientProps {
  leadId: string
}

export function LeadRecordClient({ leadId }: LeadRecordClientProps) {
  const { getLead, activitiesFor } = useLeads()
  const [convertTarget, setConvertTarget] = useState<Lead | null>(null)

  const lead = getLead(leadId)
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

  return (
    <div className="mx-auto max-w-6xl p-6">
      <LeadRecordHeader lead={lead} />

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* Left — history */}
        <div className="space-y-4 lg:order-1">
          <LeadActivityForm leadId={lead.id} />
          <LeadActivityTimeline activities={activities} />
        </div>

        {/* Right — the record */}
        <div className="space-y-4 lg:order-2">
          <div className="rounded-xl border border-border bg-card p-5">
            <p className="text-xs font-medium uppercase tracking-wide text-foreground/40">
              Debt
            </p>
            <p className="mt-1 text-3xl font-bold tabular-nums text-foreground">
              {formatDebt(lead.debtAmount)}
            </p>
            <p className="mt-1 text-xs text-foreground/40">{lead.state}</p>
          </div>

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
            value ? 'text-foreground' : 'text-foreground/35'
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
