'use client'

import { useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, ArrowRight } from 'lucide-react'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useToast } from '@/components/ui/Toast'
import { useLeads } from '@/components/leads/LeadsStore'
import { AsicExtractUpload } from '@/components/asic/AsicExtractUpload'
import { CompanyTrustSections } from '@/components/identity/CompanyTrustSections'
import { commitChange, withExtract, withoutExtract } from '@/lib/clients/identityForm'
import { createClientFromLead } from '@/lib/leads/convert'
import { emptyConversionForm, type ConversionForm } from '@/lib/leads/conversionForm'
import type { Lead } from '@/types/leads'

interface ConvertToClientDialogProps {
  lead: Lead | null
  onClose: () => void
}

type Phase =
  | { kind: 'form' }
  | { kind: 'working' }
  /** 409 — the email already belongs to a client file. Offer to link instead. */
  | { kind: 'duplicate'; clientId: string; archived: boolean }
  /** The file was created but the lead could not be updated. Never retry. */
  | { kind: 'orphaned'; clientId: string }
  | { kind: 'failed'; message: string }

/** Nothing on this form is required, so no field ever carries an error. */
const NO_ERRORS = {}

/**
 * Conversion, and the details it can collect.
 *
 * Offers steps 1 and 2 of the SBR intake up front so intake can open already
 * filled in — but every field is optional. A lead can be converted with the
 * form left exactly as it opened; anything missing is filled in on intake.
 * A cleared name or email falls back to the lead's own.
 *
 * Still the most consequential action in the CRM — it writes into the
 * restructuring workspace — so it never happens on a stray select change.
 */
export function ConvertToClientDialog({ lead, onClose }: ConvertToClientDialogProps) {
  const { markConverted, applyConverted } = useLeads()
  const { toast } = useToast()
  const [phase, setPhase] = useState<Phase>({ kind: 'form' })
  const [form, setForm] = useState<ConversionForm>(() => emptyConversionForm(lead))

  // Reset when a different lead is opened. React-sanctioned "adjust state
  // during render" — same pattern as ClientsPageClient, no effect needed.
  const [prevLeadId, setPrevLeadId] = useState<string | null>(lead?.id ?? null)
  if ((lead?.id ?? null) !== prevLeadId) {
    setPrevLeadId(lead?.id ?? null)
    setPhase({ kind: 'form' })
    setForm(emptyConversionForm(lead))
  }

  function patch(change: Partial<ConversionForm>) {
    setForm((current) => ({ ...current, ...change }))
  }

  async function link(clientId: string) {
    if (!lead) return
    setPhase({ kind: 'working' })
    try {
      await markConverted(lead.id, clientId)
      toast('Lead linked to client file.', {
        href: `/clients/${clientId}`,
        linkLabel: 'Open client file',
      })
      onClose()
    } catch {
      setPhase({ kind: 'orphaned', clientId })
    }
  }

  async function handleConvert() {
    if (!lead) return

    setPhase({ kind: 'working' })
    // No checks: the client row only needs a name and an email, and the lead
    // always has both.
    const result = await createClientFromLead(
      { ...form, name: form.name.trim() || lead.name, email: form.email.trim() || lead.email },
      lead.id,
    )

    if (result.kind === 'failed') {
      setPhase({ kind: 'failed', message: result.message })
      return
    }
    if (result.kind === 'duplicate') {
      setPhase({ kind: 'duplicate', clientId: result.clientId, archived: result.archived })
      return
    }

    if (result.leadLinked) {
      // The route marked the lead converted in the same request as the file,
      // so there is nothing left to send — and nothing a reload can interrupt.
      applyConverted(lead.id, result.clientId, result.activity)
    } else {
      // The client file now exists. From here a failure is an inconsistency to
      // report, not something to retry — retrying would create a second file.
      try {
        await markConverted(lead.id, result.clientId)
      } catch {
        setPhase({ kind: 'orphaned', clientId: result.clientId })
        return
      }
    }

    toast('Client file created.', {
      href: `/clients/${result.clientId}`,
      linkLabel: 'Open client file',
    })
    onClose()
  }

  const working = phase.kind === 'working'
  const showForm = phase.kind === 'form' || working || phase.kind === 'failed'

  return (
    <Dialog
      open={lead !== null}
      onClose={working ? () => {} : onClose}
      title={
        phase.kind === 'duplicate'
          ? phase.archived
            ? 'This email has an archived client file'
            : 'This email already has a client file'
          : 'Convert to client'
      }
      description={
        lead && showForm
          ? `These details start ${lead.name}'s intake. Everything here can be changed later on the intake form.`
          : undefined
      }
      className="max-w-2xl"
      footer={<Footer phase={phase} onConvert={handleConvert} onLink={link} onClose={onClose} />}
    >
      {lead && (
        <div className="space-y-4">
          {showForm && (
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault()
                void handleConvert()
              }}
            >
              {/* First thing in the form, because it is the quickest way to
                  fill it: the company name, ACN and ABN where empty, the two
                  addresses and the directors. Never the lead's own name, and
                  never the trust — trusts are not registered with ASIC. */}
              <AsicExtractUpload
                id="convert-asic-extract"
                layout="centered"
                acnNumber={form.acnNumber}
                fill={form.asicFill}
                disabled={working}
                onFill={(extract, mode) =>
                  setForm(commitChange(withExtract(form, extract, mode), 'no_abn'))
                }
                onUndo={() => setForm(withoutExtract(form))}
              />

              <Fieldset legend="Client">
                <Input
                  id="convert-name"
                  label="Lead name"
                  value={form.name}
                  disabled={working}
                  onChange={(event) => patch({ name: event.target.value })}
                />
                <Input
                  id="convert-email"
                  label="Email"
                  type="email"
                  value={form.email}
                  disabled={working}
                  onChange={(event) => patch({ email: event.target.value })}
                />
                <Input
                  id="convert-client-phone"
                  label="Phone (optional)"
                  type="tel"
                  autoComplete="tel"
                  value={form.phone}
                  disabled={working}
                  onChange={(event) => patch({ phone: event.target.value })}
                />
              </Fieldset>

              {/* The company, and the trust when it is a trustee. The lead's
                  own name above is never overwritten by a director or a
                  register pick: the lead is the person who enquired. */}
              <CompanyTrustSections
                idPrefix="convert"
                value={form}
                errors={NO_ERRORS}
                showDirectorErrors={false}
                disabled={working}
                onChange={(next) => setForm(next)}
                companyExtras={
                  <>
                    <Input
                      id="convert-phone"
                      label="Company phone (optional)"
                      value={form.phoneNumber}
                      disabled={working}
                      onChange={(event) => patch({ phoneNumber: event.target.value })}
                    />
                    <Input
                      id="convert-entity-email"
                      label="Company email (optional)"
                      type="email"
                      value={form.emailAddress}
                      disabled={working}
                      onChange={(event) => patch({ emailAddress: event.target.value })}
                    />
                  </>
                }
              />
            </form>
          )}

          {phase.kind === 'duplicate' && !phase.archived && (
            <>
              <p className="text-sm leading-relaxed text-foreground/70">
                {lead.email} already belongs to a client file. Rather than create a second one,
                link {lead.name} to the existing file.
              </p>
              <Link
                href={`/clients/${phase.clientId}`}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline"
              >
                Look at the existing file first
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </>
          )}

          {phase.kind === 'duplicate' && phase.archived && (
            <>
              <p className="text-sm leading-relaxed text-foreground/70">
                {lead.email} belongs to a client file in the Archive. Make it a client again from
                the Archive and link {lead.name} to it, or delete it permanently there and convert
                again.
              </p>
              <Link
                href={`/sbr/archive/${phase.clientId}`}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline"
              >
                Open the archived file
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </>
          )}

          {phase.kind === 'orphaned' && (
            <div className="space-y-3 rounded-lg border border-warning/30 bg-warning/10 p-3">
              <p className="flex items-start gap-2 text-sm leading-relaxed text-foreground/80">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
                Client file created, but this lead wasn&rsquo;t updated.
              </p>
              <Link
                href={`/clients/${phase.clientId}`}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline"
              >
                Open the client file
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </div>
          )}

          {phase.kind === 'failed' && (
            <p className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              {phase.message}
            </p>
          )}
        </div>
      )}
      {working && <span className="sr-only">Creating the client file…</span>}
    </Dialog>
  )
}

function Fieldset({ legend, children }: { legend: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-3">
      <legend className="text-xs font-medium uppercase tracking-wide text-foreground/40">
        {legend}
      </legend>
      {children}
    </fieldset>
  )
}

function Footer({
  phase,
  onConvert,
  onLink,
  onClose,
}: {
  phase: Phase
  onConvert: () => void
  onLink: (clientId: string) => void
  onClose: () => void
}) {
  // Nothing to retry once the file exists — only a way out.
  if (phase.kind === 'orphaned') {
    return (
      <Button type="button" variant="ghost" onClick={onClose}>
        Close
      </Button>
    )
  }

  if (phase.kind === 'duplicate') {
    const { clientId, archived } = phase
    return (
      <>
        <Button type="button" variant="ghost" onClick={onClose}>
          {archived ? 'Close' : 'Cancel'}
        </Button>
        {/* An archived file is restored first, from the Archive. */}
        {!archived && (
          <Button type="button" onClick={() => onLink(clientId)}>
            Link to existing file
          </Button>
        )}
      </>
    )
  }

  const working = phase.kind === 'working'
  return (
    <>
      <Button type="button" variant="ghost" onClick={onClose} disabled={working}>
        Cancel
      </Button>
      <Button type="button" onClick={onConvert} loading={working}>
        {phase.kind === 'failed' ? 'Try again' : 'Convert'}
      </Button>
    </>
  )
}
