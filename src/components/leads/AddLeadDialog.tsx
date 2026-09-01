'use client'

import { useState } from 'react'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { useToast } from '@/components/ui/Toast'
import { useLeads } from '@/components/leads/LeadsStore'
import { AU_STATES, SOURCE_META } from '@/lib/leads/constants'
import { isValidAuMobile, isValidEmail, parseDebtInput } from '@/lib/leads/format'
import type { AuState } from '@/types/leads'

interface AddLeadDialogProps {
  open: boolean
  onClose: () => void
}

interface FormState {
  name: string
  email: string
  phone: string
  debt: string
  state: string
  note: string
}

const EMPTY: FormState = { name: '', email: '', phone: '', debt: '', state: '', note: '' }

type FieldErrors = Partial<Record<keyof FormState, string>>

const STATE_OPTIONS = AU_STATES.map((state) => ({ value: state, label: state }))

/**
 * Add a lead by hand.
 *
 * There is deliberately no company field — it was cut from the public capture
 * form to reduce friction on the ad, and this mirrors that form. Company can be
 * added on the record afterwards.
 */
export function AddLeadDialog({ open, onClose }: AddLeadDialogProps) {
  const { addLead } = useLeads()
  const { toast } = useToast()
  const [form, setForm] = useState<FormState>(EMPTY)
  const [errors, setErrors] = useState<FieldErrors>({})

  function set(field: keyof FormState, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
    setErrors((prev) => ({ ...prev, [field]: undefined }))
  }

  function validate(): FieldErrors {
    const next: FieldErrors = {}
    if (!form.name.trim()) next.name = 'Enter a name.'
    if (!form.email.trim()) next.email = 'Enter an email address.'
    else if (!isValidEmail(form.email)) next.email = 'That email address does not look right.'
    if (!form.phone.trim()) next.phone = 'Enter a phone number.'
    else if (!isValidAuMobile(form.phone))
      next.phone = 'Enter an Australian mobile, e.g. 0412 345 678.'
    if (!form.debt.trim()) next.debt = 'Enter the debt amount.'
    else if (parseDebtInput(form.debt) === null)
      next.debt = 'Enter a positive amount, e.g. $41,500.'
    if (!form.state) next.state = 'Choose a state.'
    return next
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const found = validate()
    if (Object.keys(found).length > 0) {
      setErrors(found)
      return
    }

    addLead({
      name: form.name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      debtAmount: parseDebtInput(form.debt)!,
      state: form.state as AuState,
      note: form.note,
    })

    toast('Lead added.')
    handleClose()
  }

  function handleClose() {
    setForm(EMPTY)
    setErrors({})
    onClose()
  }

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title="Add lead"
      description="Everything except the note is required."
      footer={
        <>
          <Button type="button" variant="ghost" onClick={handleClose}>
            Cancel
          </Button>
          <Button type="submit" form="add-lead-form">
            Add lead
          </Button>
        </>
      }
    >
      <form id="add-lead-form" onSubmit={handleSubmit} className="space-y-4" noValidate>
        <Input
          id="lead-name"
          label="Name"
          value={form.name}
          onChange={(event) => set('name', event.target.value)}
          error={errors.name}
        />
        <Input
          id="lead-email"
          label="Email"
          type="email"
          placeholder="name@company.com.au"
          value={form.email}
          onChange={(event) => set('email', event.target.value)}
          error={errors.email}
        />
        <Input
          id="lead-phone"
          label="Phone"
          inputMode="tel"
          placeholder="0412 345 678"
          value={form.phone}
          onChange={(event) => set('phone', event.target.value)}
          error={errors.phone}
        />
        <div className="grid grid-cols-2 gap-3">
          <Input
            id="lead-debt"
            label="Debt amount"
            inputMode="decimal"
            placeholder="$41,500"
            value={form.debt}
            onChange={(event) => set('debt', event.target.value)}
            error={errors.debt}
          />
          <Select
            id="lead-state"
            label="State"
            placeholder="Select"
            value={form.state}
            onChange={(event) => set('state', event.target.value)}
            options={STATE_OPTIONS}
            error={errors.state}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="lead-note" className="text-xs font-medium text-muted">
            Note <span className="text-foreground/35">(optional)</span>
          </label>
          <textarea
            id="lead-note"
            rows={3}
            value={form.note}
            onChange={(event) => set('note', event.target.value)}
            placeholder="Saved as the first entry in their history."
            className="w-full resize-y rounded-lg border border-border bg-input-bg px-3 py-2 text-sm text-foreground placeholder:text-muted transition-colors focus:border-accent focus:outline-none"
          />
        </div>

        <div className="flex items-center justify-between rounded-lg border border-border bg-surface/40 px-3 py-2.5">
          <span className="text-xs text-muted">Source</span>
          <span className="text-xs text-foreground/70">{SOURCE_META.manual.label}</span>
        </div>
      </form>
    </Dialog>
  )
}
