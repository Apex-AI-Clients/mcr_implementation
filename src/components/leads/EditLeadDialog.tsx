'use client'

import { useState } from 'react'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { MultiSelect } from '@/components/ui/MultiSelect'
import { useToast } from '@/components/ui/Toast'
import { useLeads } from '@/components/leads/LeadsStore'
import {
  ALL_ENTITY_TYPES,
  ALL_SOURCES,
  AU_STATES,
  ENTITY_TYPE_META,
  SOURCE_META,
} from '@/lib/leads/constants'
import {
  debtSelectOptions,
  decodeDebtRange,
  isValidEmail,
  isValidPhone,
  stateColumns,
} from '@/lib/leads/format'
import { parseLooseDebt, type LooseDebtFailure } from '@/lib/leads/ingest'
import { MIN_PLAUSIBLE_DEBT } from '@/lib/leads/ingestConfig'
import type { AuState, EntityType, Lead, LeadSource } from '@/types/leads'

interface EditLeadDialogProps {
  lead: Lead
  onClose: () => void
}

const LABEL_MAX = 100
const STATE_TEXT_MAX = 200

interface FormState {
  name: string
  email: string
  phone: string
  /** encodeDebtRange value, as debtSelectOptions gives it. */
  debt: string
  debtTyped: boolean
  /** A figure as people type it: "120000", "$120k". */
  debtText: string
  states: AuState[]
  stateTyped: boolean
  stateText: string
  entityType: string
  entityTyped: boolean
  entityText: string
  source: LeadSource
  sourceTyped: boolean
  sourceText: string
  message: string
  preferredCallTime: string
}

type FieldErrors = Partial<Record<keyof FormState, string>>
type TextField = {
  [K in keyof FormState]: FormState[K] extends string ? K : never
}[keyof FormState]
type ToggleField = 'debtTyped' | 'stateTyped' | 'entityTyped' | 'sourceTyped'

const DEBT_FAILURE: Record<LooseDebtFailure, string> = {
  not_a_number: 'Enter an amount, e.g. 120000 or $120k.',
  ambiguous: 'Enter one amount, not a range.',
  too_small: `Enter at least $${MIN_PLAUSIBLE_DEBT.toLocaleString('en-AU')}.`,
}

const STATE_OPTIONS = AU_STATES.map((state) => ({ value: state, label: state }))
const ENTITY_OPTIONS = ALL_ENTITY_TYPES.map((type) => ({
  value: type,
  label: ENTITY_TYPE_META[type].label,
}))
const SOURCE_OPTIONS = ALL_SOURCES.map((source) => ({
  value: source,
  label: SOURCE_META[source].label,
}))

function statesOf(lead: Lead): AuState[] {
  if (lead.state) return [lead.state]
  return lead.metaStateOptions ?? []
}

/** A form's state answer that matched no state ("Australia wide"), or null. */
function typedStateOf(lead: Lead): string | null {
  return !lead.state && !lead.metaStateOptions ? lead.metaStateRaw : null
}

function initialForm(lead: Lead): FormState {
  // An exact figure was typed by someone; a bracket came from a form.
  const exactDebt = lead.debtMin !== null && lead.debtMin === lead.debtMax
  const typedState = typedStateOf(lead)
  return {
    name: lead.name,
    email: lead.email,
    phone: lead.phone,
    debt: debtSelectOptions(lead.debtMin, lead.debtMax).value,
    debtTyped: exactDebt,
    debtText: exactDebt ? String(lead.debtMin) : '',
    states: statesOf(lead),
    stateTyped: typedState !== null,
    stateText: typedState ?? '',
    entityType: lead.entityType ?? '',
    entityTyped: lead.entityTypeLabel !== null,
    entityText: lead.entityTypeLabel ?? '',
    source: lead.source,
    sourceTyped: lead.sourceLabel !== null,
    sourceText: lead.sourceLabel ?? '',
    message: lead.message ?? '',
    preferredCallTime: lead.preferredCallTime ?? '',
  }
}

function sameStates(a: readonly AuState[], b: readonly AuState[]): boolean {
  return a.length === b.length && a.every((state) => b.includes(state))
}

/**
 * Edit every detail of a lead in one form, prefilled from the record.
 *
 * Debt, state, business type and source each have a "Type my own" checkbox:
 * unticked, the value comes from the list; ticked, staff type whatever they
 * know. Typed values are stored where they cannot break what reads the listed
 * ones:
 *
 *  - Debt: parsed to an exact figure (min === max), as DebtInput does.
 *  - State: kept as given in `metaStateRaw`, like a form answer that matched
 *    no state. Shown on the record; matches no state filter.
 *  - Business type: `entityTypeLabel`, shown instead of company or trust.
 *    `entityType` is cleared so the trust rules do not act on a stale value.
 *  - Source: `sourceLabel`, shown instead of `source`, which keeps doing its
 *    job for filters and delivery dedup.
 *
 * Only the fields that changed are sent, as one UPDATE_LEAD: a data
 * correction, so no activity and the follow-up clock does not move. Lead
 * history keeps what each enquiry said.
 */
export function EditLeadDialog({ lead, onClose }: EditLeadDialogProps) {
  const { updateLead } = useLeads()
  const { toast } = useToast()
  const [form, setForm] = useState<FormState>(() => initialForm(lead))
  const [errors, setErrors] = useState<FieldErrors>({})
  const debt = debtSelectOptions(lead.debtMin, lead.debtMax)

  function set(field: TextField, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
    setErrors((prev) => ({ ...prev, [field]: undefined }))
  }

  function toggle(field: ToggleField, typed: boolean) {
    setForm((prev) => ({ ...prev, [field]: typed }))
    // A typed value's error does not carry over to the list, or back.
    setErrors((prev) => ({
      ...prev,
      debtText: undefined,
      entityText: undefined,
      sourceText: undefined,
    }))
  }

  function setStates(states: string[]) {
    setForm((prev) => ({ ...prev, states: states as AuState[] }))
  }

  function validate(): FieldErrors {
    const next: FieldErrors = {}
    if (!form.name.trim()) next.name = 'Enter a name.'
    if (!form.email.trim()) next.email = 'Enter an email address.'
    else if (!isValidEmail(form.email)) next.email = 'That email address does not look right.'
    if (!form.phone.trim()) next.phone = 'Enter a phone number.'
    else if (!isValidPhone(form.phone))
      next.phone = 'Enter a phone number using digits only, e.g. 0412 345 678.'
    if (form.debtTyped) {
      const parsed = parseLooseDebt(form.debtText)
      if (parsed.kind === 'unparseable') next.debtText = DEBT_FAILURE[parsed.reason]
    }
    if (form.entityTyped && !form.entityText.trim()) {
      next.entityText = 'Type the business type, or untick to pick one.'
    }
    if (form.sourceTyped && !form.sourceText.trim()) {
      next.sourceText = 'Type the source, or untick to pick one.'
    }
    return next
  }

  function debtPatch(): Partial<Lead> {
    let min: number | null
    let max: number | null
    if (form.debtTyped) {
      const parsed = parseLooseDebt(form.debtText)
      if (parsed.kind === 'unparseable') return {}
      min = parsed.kind === 'absent' ? null : parsed.min
      max = parsed.kind === 'absent' ? null : parsed.max
    } else {
      if (form.debt === debt.value) return {}
      ;({ min, max } = decodeDebtRange(form.debt))
    }
    if (min === lead.debtMin && max === lead.debtMax) return {}
    return { debtMin: min, debtMax: max }
  }

  function statePatch(): Partial<Lead> {
    const typedBefore = typedStateOf(lead)
    if (form.stateTyped) {
      const text = form.stateText.trim() || null
      if (text === typedBefore && statesOf(lead).length === 0) return {}
      return { state: null, metaStateOptions: null, metaStateRaw: text }
    }
    if (sameStates(form.states, statesOf(lead)) && typedBefore === null) return {}
    return stateColumns(form.states)
  }

  function entityPatch(): Partial<Lead> {
    if (form.entityTyped) {
      const text = form.entityText.trim()
      if (text === lead.entityTypeLabel) return {}
      return { entityTypeLabel: text, entityType: null }
    }
    const entityType = (form.entityType || null) as EntityType | null
    const patch: Partial<Lead> = {}
    if (entityType !== lead.entityType) patch.entityType = entityType
    if (lead.entityTypeLabel !== null) patch.entityTypeLabel = null
    return patch
  }

  function sourcePatch(): Partial<Lead> {
    if (form.sourceTyped) {
      const text = form.sourceText.trim()
      return text === lead.sourceLabel ? {} : { sourceLabel: text }
    }
    const patch: Partial<Lead> = {}
    if (form.source !== lead.source) patch.source = form.source
    if (lead.sourceLabel !== null) patch.sourceLabel = null
    return patch
  }

  function buildPatch(): Partial<Lead> {
    const patch: Partial<Lead> = {}
    const name = form.name.trim()
    const email = form.email.trim().toLowerCase()
    const phone = form.phone.trim()
    if (name !== lead.name) patch.name = name
    if (email !== lead.email) patch.email = email
    if (phone !== lead.phone) patch.phone = phone

    Object.assign(patch, debtPatch(), statePatch(), entityPatch(), sourcePatch())

    const message = form.message.trim() || null
    if (message !== lead.message) patch.message = message
    const callTime = form.preferredCallTime.trim() || null
    if (callTime !== lead.preferredCallTime) patch.preferredCallTime = callTime
    return patch
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const found = validate()
    if (Object.keys(found).length > 0) {
      setErrors(found)
      return
    }

    const patch = buildPatch()
    if (Object.keys(patch).length > 0) {
      updateLead(lead.id, patch)
      toast('Lead updated.')
    }
    onClose()
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Edit lead"
      description="Name, email and phone are required. Lead history keeps what each enquiry said."
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="edit-lead-form">
            Save changes
          </Button>
        </>
      }
    >
      <form id="edit-lead-form" onSubmit={handleSubmit} className="space-y-4" noValidate>
        <Input
          id="edit-lead-name"
          label="Name"
          value={form.name}
          onChange={(event) => set('name', event.target.value)}
          error={errors.name}
        />
        <Input
          id="edit-lead-email"
          label="Email"
          type="email"
          value={form.email}
          onChange={(event) => set('email', event.target.value)}
          error={errors.email}
        />
        <Input
          id="edit-lead-phone"
          label="Phone"
          inputMode="tel"
          value={form.phone}
          onChange={(event) => set('phone', event.target.value)}
          error={errors.phone}
        />

        <TypeableField
          id="edit-lead-debt"
          label="Debt"
          typed={form.debtTyped}
          onTypedChange={(typed) => toggle('debtTyped', typed)}
        >
          {form.debtTyped ? (
            <Input
              id="edit-lead-debt"
              inputMode="decimal"
              placeholder="e.g. 120000 or $120k. Blank for not given."
              value={form.debtText}
              onChange={(event) => set('debtText', event.target.value)}
              error={errors.debtText}
            />
          ) : (
            <Select
              id="edit-lead-debt"
              value={form.debt}
              onChange={(event) => set('debt', event.target.value)}
              options={debt.options}
            />
          )}
        </TypeableField>

        <TypeableField
          id="edit-lead-state"
          label="State"
          typed={form.stateTyped}
          onTypedChange={(typed) => toggle('stateTyped', typed)}
        >
          {form.stateTyped ? (
            <Input
              id="edit-lead-state"
              placeholder="e.g. Australia wide. Blank for not given."
              maxLength={STATE_TEXT_MAX}
              value={form.stateText}
              onChange={(event) => set('stateText', event.target.value)}
              hint={
                <p className="text-xs text-foreground/40">
                  Shown as given. A typed state does not match the state filter.
                </p>
              }
            />
          ) : (
            <MultiSelect
              id="edit-lead-state"
              placeholder="Not given"
              options={STATE_OPTIONS}
              value={form.states}
              onChange={setStates}
            />
          )}
        </TypeableField>

        <TypeableField
          id="edit-lead-entity"
          label="Business type"
          typed={form.entityTyped}
          onTypedChange={(typed) => toggle('entityTyped', typed)}
        >
          {form.entityTyped ? (
            <Input
              id="edit-lead-entity"
              placeholder="e.g. Sole trader, Partnership"
              maxLength={LABEL_MAX}
              value={form.entityText}
              onChange={(event) => set('entityText', event.target.value)}
              error={errors.entityText}
            />
          ) : (
            <Select
              id="edit-lead-entity"
              placeholder="Not given"
              value={form.entityType}
              onChange={(event) => set('entityType', event.target.value)}
              options={ENTITY_OPTIONS}
            />
          )}
        </TypeableField>

        <TypeableField
          id="edit-lead-source"
          label="Source"
          typed={form.sourceTyped}
          onTypedChange={(typed) => toggle('sourceTyped', typed)}
        >
          {form.sourceTyped ? (
            <Input
              id="edit-lead-source"
              placeholder="e.g. Referral, Trade show"
              maxLength={LABEL_MAX}
              value={form.sourceText}
              onChange={(event) => set('sourceText', event.target.value)}
              error={errors.sourceText}
            />
          ) : (
            <Select
              id="edit-lead-source"
              value={form.source}
              onChange={(event) => set('source', event.target.value)}
              options={SOURCE_OPTIONS}
            />
          )}
        </TypeableField>

        <Input
          id="edit-lead-call-time"
          label="Preferred call time"
          placeholder="Not given"
          value={form.preferredCallTime}
          onChange={(event) => set('preferredCallTime', event.target.value)}
        />

        <div className="flex flex-col gap-1.5">
          <label htmlFor="edit-lead-message" className="text-xs font-medium text-muted">
            Their message
          </label>
          <textarea
            id="edit-lead-message"
            rows={4}
            value={form.message}
            onChange={(event) => set('message', event.target.value)}
            placeholder="Not given"
            className="w-full resize-y rounded-lg border border-border bg-input-bg px-3 py-2 text-sm text-foreground placeholder:text-muted transition-colors focus:border-accent focus:outline-none"
          />
        </div>
      </form>
    </Dialog>
  )
}

interface TypeableFieldProps {
  /** The id of the field below, which this label names. */
  id: string
  label: string
  typed: boolean
  onTypedChange: (typed: boolean) => void
  children: React.ReactNode
}

/**
 * A field's label with a "Type my own" checkbox beside it. Ticked, the field
 * below is a text box; unticked, it is the list.
 */
function TypeableField({ id, label, typed, onTypedChange, children }: TypeableFieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={id} className="text-xs font-medium text-muted">
          {label}
        </label>
        <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-muted">
          <input
            type="checkbox"
            checked={typed}
            onChange={(event) => onTypedChange(event.target.checked)}
            aria-label={`Type my own ${label.toLowerCase()}`}
            className="h-3.5 w-3.5 cursor-pointer rounded border-border accent-accent"
          />
          Type my own
        </label>
      </div>
      {children}
    </div>
  )
}
