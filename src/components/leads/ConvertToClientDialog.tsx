'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, ArrowRight } from 'lucide-react'
import { Dialog } from '@/components/ui/Dialog'
import { LoadingOverlay } from '@/components/ui/LoadingOverlay'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useToast } from '@/components/ui/Toast'
import { useLeads } from '@/components/leads/LeadsStore'
import { AsicExtractUpload } from '@/components/asic/AsicExtractUpload'
import { CompanyTrustSections } from '@/components/identity/CompanyTrustSections'
import { commitChange, withExtract, withoutExtract } from '@/lib/clients/identityForm'
import { createClientFromLead } from '@/lib/leads/convert'
import { keepAsicExtract } from '@/lib/asic/browser'
import { contactFromEnquiry, emptyConversionForm, type ConversionForm } from '@/lib/leads/conversionForm'
import { enquiryOptionLabel, newestUnconvertedEnquiry } from '@/lib/leads/enquiries'
import { clientBase, type ClientWorkspace } from '@/lib/clients/workspace'
import { cvlEnabled } from '@/lib/cvl/flag'
import type { Lead, LeadSubmission } from '@/types/leads'

interface ConvertToClientDialogProps {
  lead: Lead | null
  /**
   * The lead's enquiries, newest first, when the page already has them (the
   * lead record). Left out on the lead list: the dialog reads them itself.
   */
  enquiries?: LeadSubmission[]
  /** The enquiry to start on. Default: the newest not yet a client file. */
  enquiryId?: string | null
  onClose: () => void
  /** After a file is made, so a page holding the enquiries can re-read them. */
  onConverted?: () => void
}

type Phase =
  | { kind: 'form' }
  | { kind: 'working'; label: string }
  /** The file was created but the lead could not be updated. Never retry. */
  | { kind: 'orphaned'; clientId: string; workflow: ClientWorkspace }
  | { kind: 'failed'; message: string }

interface EnquiriesState {
  status: 'loading' | 'ready' | 'failed'
  enquiries: LeadSubmission[]
}

/** Nothing on this form is required, so no field ever carries an error. */
const NO_ERRORS = {}

/**
 * Conversion of one enquiry, and the details it can collect (0052).
 *
 * Each enquiry a lead makes can become one client file, SBR or CVL: a lead
 * with two enquiries can have two files. Opened on one enquiry (its card on
 * the lead record), the form opens straight away. Opened on the lead (the
 * stage select, on the list or the record) with two or more enquiries, staff
 * first pick which enquiry to convert; then the form opens with what that
 * enquiry said.
 *
 * Offers steps 1 and 2 of the SBR intake up front so intake can open already
 * filled in — but every field is optional. An enquiry can be converted with
 * the form left exactly as it opened; anything missing is filled in on
 * intake. A cleared name or email falls back to the enquiry's own.
 *
 * Still the most consequential action in the CRM — it writes into the
 * restructuring workspace — so it never happens on a stray select change.
 */
export function ConvertToClientDialog({ lead, ...rest }: ConvertToClientDialogProps) {
  // Mounted per lead and starting enquiry, so every opening starts clean.
  if (!lead) return null
  return <ConvertDialogBody key={`${lead.id}:${rest.enquiryId ?? ''}`} lead={lead} {...rest} />
}

/** The lead's enquiries: the ones handed in, or read once from the server. */
function useEnquiries(leadId: string, given: LeadSubmission[] | undefined): EnquiriesState {
  const [loaded, setLoaded] = useState<EnquiriesState>({ status: 'loading', enquiries: [] })
  const needsRead = given === undefined
  useEffect(() => {
    if (!needsRead) return
    let cancelled = false
    fetch(`/api/admin/leads/${leadId}/enquiries`)
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((body: { enquiries?: unknown }) => {
        if (cancelled) return
        setLoaded({
          status: 'ready',
          enquiries: Array.isArray(body.enquiries) ? (body.enquiries as LeadSubmission[]) : [],
        })
      })
      .catch(() => {
        if (!cancelled) setLoaded({ status: 'failed', enquiries: [] })
      })
    return () => {
      cancelled = true
    }
  }, [leadId, needsRead])
  return given ? { status: 'ready', enquiries: given } : loaded
}

function ConvertDialogBody({
  lead,
  enquiries: given,
  enquiryId = null,
  onClose,
  onConverted,
}: Omit<ConvertToClientDialogProps, 'lead'> & { lead: Lead }) {
  const { applyConverted } = useLeads()
  const { toast } = useToast()
  const loaded = useEnquiries(lead.id, given)
  const enquiries = loaded.enquiries
  const [pickedId, setPickedId] = useState<string | null>(enquiryId)
  // Opened on the lead rather than one enquiry: with two or more enquiries,
  // which one to convert is asked first, in a step of its own.
  const [picking, setPicking] = useState(enquiryId === null)
  // The picked enquiry while it is still unconverted, else the newest that is.
  const enquiry =
    enquiries.find((e) => e.id === pickedId && !e.convertedClientId) ?? newestUnconvertedEnquiry(enquiries)
  const convertedCount = enquiries.filter((e) => e.convertedClientId).length

  const [phase, setPhase] = useState<Phase>({ kind: 'form' })
  const [form, setForm] = useState<ConversionForm>(() => emptyConversionForm(lead, enquiry))
  // Which workspace the new file opens in. SBR unless staff choose CVL.
  const [workflow, setWorkflow] = useState<ClientWorkspace>('sbr')
  // The extract PDF read into the form, kept on the new file once it exists (migration 0041).
  const [extractFile, setExtractFile] = useState<File | null>(null)

  // The contact fields follow the enquiry: when another is picked, or once the
  // enquiries arrive. React-sanctioned "adjust state during render".
  const [filledFrom, setFilledFrom] = useState<string | null>(enquiry?.id ?? null)
  if ((enquiry?.id ?? null) !== filledFrom) {
    setFilledFrom(enquiry?.id ?? null)
    setForm((current) => ({ ...current, ...contactFromEnquiry(lead, enquiry) }))
  }

  function patch(change: Partial<ConversionForm>) {
    setForm((current) => ({ ...current, ...change }))
  }

  async function handleConvert() {
    if (!enquiry) return

    setPhase({ kind: 'working', label: workflow === 'cvl' ? 'Creating CVL client file…' : 'Creating client file…' })
    // No checks: the client row only needs a name and an email, and the
    // enquiry (or the lead behind it) always has both.
    const fallback = contactFromEnquiry(lead, enquiry)
    const result = await createClientFromLead(
      { ...form, name: form.name.trim() || fallback.name, email: form.email.trim() || fallback.email },
      enquiry.id,
      workflow,
    )

    if (result.kind === 'failed' || result.kind === 'enquiry_converted') {
      setPhase({ kind: 'failed', message: result.message })
      return
    }

    if (!result.leadLinked) {
      // The file exists but the server did not say the lead was updated.
      // Report it rather than retry: retrying would create a second file.
      setPhase({ kind: 'orphaned', clientId: result.clientId, workflow })
      return
    }
    // The route linked the enquiry and marked the lead converted in the same
    // request as the file, so there is nothing left to send.
    applyConverted(lead.id, result.clientId, result.activity)

    // The extract itself, now the file exists. Never undoes the conversion.
    const kept = extractFile ? await keepAsicExtract(result.clientId, extractFile) : { ok: true as const }

    toast(`${workflow === 'cvl' ? 'CVL client file created.' : 'Client file created.'}${kept.ok ? '' : ` ${kept.message}`}`, {
      href: clientBase(result.clientId, workflow),
      linkLabel: 'Open client file',
    })
    onConverted?.()
    onClose()
  }

  const working = phase.kind === 'working'
  const canConvert = loaded.status === 'ready' && enquiry !== null
  // Asked first only when there is a real choice to see: two or more
  // enquiries, at least one still without a file.
  const canPick = enquiryId === null && canConvert && enquiries.length > 1

  if (picking && canPick && enquiry) {
    return (
      <PickEnquiryStep
        lead={lead}
        enquiries={enquiries}
        initial={enquiry.id}
        onCancel={onClose}
        onContinue={(id) => {
          setPickedId(id)
          setPicking(false)
        }}
      />
    )
  }

  const showForm = canConvert && (phase.kind === 'form' || working || phase.kind === 'failed')

  return (
    <>
      <Dialog
        open
        onClose={working ? () => {} : onClose}
        title="Convert to client"
        description={
          showForm
            ? `These details start ${form.name.trim() || lead.name}'s intake. Everything here can be changed later on the intake form.`
            : undefined
        }
        className="max-w-2xl"
        footer={<Footer phase={phase} canConvert={canConvert} onConvert={handleConvert} onClose={onClose} />}
      >
        <div className="space-y-4">
          <EnquiryChoice
            state={loaded}
            enquiry={enquiry}
            convertedCount={convertedCount}
            disabled={working || phase.kind === 'orphaned'}
            onChange={canPick ? () => setPicking(true) : undefined}
          />

          {showForm && (
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault()
                void handleConvert()
              }}
            >
              {cvlEnabled() && <WorkflowChoice value={workflow} disabled={working} onChange={setWorkflow} />}

              {/* The quickest way to fill the form: the company name, ACN and
                  ABN where empty, the two addresses and the directors. Never
                  the lead's own name, and never the trust — trusts are not
                  registered with ASIC. */}
              <AsicExtractUpload
                id="convert-asic-extract"
                layout="centered"
                acnNumber={form.acnNumber}
                fill={form.asicFill}
                disabled={working}
                onFill={(extract, mode, file) => {
                  setForm(commitChange(withExtract(form, extract, mode), 'no_abn'))
                  setExtractFile(file)
                }}
                onUndo={() => {
                  setForm(withoutExtract(form))
                  setExtractFile(null)
                }}
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

          {phase.kind === 'orphaned' && (
            <div className="space-y-3 rounded-lg border border-warning/30 bg-warning/10 p-3">
              <p className="flex items-start gap-2 text-sm leading-relaxed text-foreground/80">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
                Client file created, but this lead wasn&rsquo;t updated.
              </p>
              <Link
                href={clientBase(phase.clientId, phase.workflow)}
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
      </Dialog>

      {phase.kind === 'working' && <LoadingOverlay label={phase.label} />}
    </>
  )
}

/**
 * Which enquiry becomes the file, said plainly. When it was picked in the
 * step before, Change goes back to that step.
 */
function EnquiryChoice({
  state,
  enquiry,
  convertedCount,
  disabled,
  onChange,
}: {
  state: EnquiriesState
  enquiry: LeadSubmission | null
  convertedCount: number
  disabled: boolean
  onChange?: () => void
}) {
  if (state.status === 'loading') {
    return <p className="text-sm text-foreground/50">Loading this lead&rsquo;s enquiries…</p>
  }
  if (state.status === 'failed') {
    return (
      <p className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        Couldn&rsquo;t load this lead&rsquo;s enquiries. Close this and try again.
      </p>
    )
  }
  if (!enquiry) {
    return (
      <p className="rounded-lg border border-border bg-surface/60 p-3 text-sm leading-relaxed text-foreground/70">
        {state.enquiries.length === 0
          ? 'This lead has no enquiry to convert.'
          : 'Every enquiry from this lead already has a client file. A new enquiry from them can be converted when it arrives.'}
      </p>
    )
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-foreground/70">
        <span className="text-foreground/40">Enquiry </span>
        <span className="font-medium text-foreground">{enquiryOptionLabel(enquiry)}</span>
        {onChange && (
          <>
            {' '}
            <button
              type="button"
              disabled={disabled}
              onClick={onChange}
              className="text-xs text-accent hover:underline disabled:opacity-50"
            >
              Change
            </button>
          </>
        )}
      </p>
      {convertedCount > 0 && (
        <p className="text-xs text-foreground/50">
          {convertedCount === 1
            ? 'This lead already has 1 client file.'
            : `This lead already has ${convertedCount} client files.`}{' '}
          This enquiry becomes a separate file.
        </p>
      )}
    </div>
  )
}

/**
 * The step before the form, when the lead has two or more enquiries: which
 * one becomes the file. Enquiries that already have a file are listed, so the
 * whole history is visible, but cannot be picked.
 */
function PickEnquiryStep({
  lead,
  enquiries,
  initial,
  onCancel,
  onContinue,
}: {
  lead: Lead
  enquiries: LeadSubmission[]
  initial: string
  onCancel: () => void
  onContinue: (enquiryId: string) => void
}) {
  const [selected, setSelected] = useState(initial)
  return (
    <Dialog
      open
      onClose={onCancel}
      title="Which enquiry?"
      description={`${lead.name} has ${enquiries.length} enquiries. Each one can become its own client file. Pick the one to convert.`}
      className="max-w-lg"
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" onClick={() => onContinue(selected)}>
            Continue
          </Button>
        </>
      }
    >
      {/* The list scrolls on its own, so Continue stays in view with ten enquiries. */}
      <fieldset className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
        <legend className="sr-only">Enquiry to convert</legend>
        {enquiries.map((e) => {
          const taken = !!e.convertedClientId
          const contact = [e.name, e.email].filter(Boolean).join(' · ')
          return (
            <label
              key={e.id}
              className={`flex items-start gap-2 rounded-lg border p-3 text-sm transition-colors ${
                taken
                  ? 'cursor-not-allowed border-border opacity-60'
                  : selected === e.id
                    ? 'cursor-pointer border-accent/50 bg-accent/10'
                    : 'cursor-pointer border-border hover:bg-surface/60'
              }`}
            >
              <input
                type="radio"
                name="convert-pick-enquiry"
                value={e.id}
                checked={selected === e.id}
                disabled={taken}
                onChange={() => setSelected(e.id)}
                className="mt-0.5 accent-accent"
              />
              <span className="min-w-0">
                <span className="block font-medium text-foreground">{enquiryOptionLabel(e)}</span>
                {contact && <span className="block break-words text-xs text-foreground/50">{contact}</span>}
                {taken && <span className="block text-xs text-foreground/50">Already has a client file</span>}
              </span>
            </label>
          )
        })}
      </fieldset>
    </Dialog>
  )
}

/**
 * SBR client or CVL client (migration 0039). Everything else on the form is
 * the same: both start from the same client and company details.
 */
function WorkflowChoice({
  value,
  disabled,
  onChange,
}: {
  value: ClientWorkspace
  disabled: boolean
  onChange: (value: ClientWorkspace) => void
}) {
  const options: { value: ClientWorkspace; label: string; hint: string }[] = [
    { value: 'sbr', label: 'SBR client', hint: 'Small Business Restructuring' },
    { value: 'cvl', label: 'CVL client', hint: 'Creditors’ Voluntary Liquidation' },
  ]
  return (
    <fieldset className="space-y-2">
      <legend className="text-xs font-medium uppercase tracking-wide text-foreground/40">Convert to</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((o) => (
          <label
            key={o.value}
            className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm transition-colors ${
              value === o.value ? 'border-accent/50 bg-accent/10' : 'border-border hover:bg-surface/60'
            }`}
          >
            <input
              type="radio"
              name="convert-workflow"
              value={o.value}
              checked={value === o.value}
              disabled={disabled}
              onChange={() => onChange(o.value)}
              className="mt-0.5 accent-accent"
            />
            <span>
              <span className="block font-medium text-foreground">{o.label}</span>
              <span className="block text-xs text-foreground/50">{o.hint}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
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
  canConvert,
  onConvert,
  onClose,
}: {
  phase: Phase
  canConvert: boolean
  onConvert: () => void
  onClose: () => void
}) {
  // Nothing to retry once the file exists, and nothing to convert without an
  // enquiry — only a way out.
  if (phase.kind === 'orphaned' || !canConvert) {
    return (
      <Button type="button" variant="ghost" onClick={onClose}>
        Close
      </Button>
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
