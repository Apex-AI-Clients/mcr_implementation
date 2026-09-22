'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { EntityNameInput } from '@/components/abr/EntityNameInput'
import { prefillFor } from '@/lib/abr/prefill'
import type { AbrPrefill } from '@/lib/abr/types'
import { CheckCircle, ExternalLink } from 'lucide-react'

export interface CompanyDetails {
  id?: string
  clientId?: string
  companyName: string
  acnNumber: string
  abnNumber: string
  trustName: string
  phoneNumber: string
  emailAddress: string
}

interface CompanyDetailsFormProps {
  clientId: string
  initial: CompanyDetails | null
  onComplete?: () => void
}

export function CompanyDetailsForm({ clientId, initial, onComplete }: CompanyDetailsFormProps) {
  const [companyName, setCompanyName] = useState(initial?.companyName ?? '')
  const [acnNumber, setAcnNumber] = useState(initial?.acnNumber ?? '')
  const [abnNumber, setAbnNumber] = useState(initial?.abnNumber ?? '')
  const [trustName, setTrustName] = useState(initial?.trustName ?? '')
  const [phoneNumber, setPhoneNumber] = useState(initial?.phoneNumber ?? '')
  const [emailAddress, setEmailAddress] = useState(initial?.emailAddress ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(!!initial)
  const [error, setError] = useState('')

  /**
   * Adopt a record that turned up after this form mounted.
   *
   * The six useState calls above read `initial` once, which is wrong the moment
   * another step writes this record — intake step 1 now saves the ABN and ACN
   * behind a picked company name, and the reload that follows arrives here as a
   * changed prop, not a remount. Without this the form would keep showing the
   * empty boxes it was born with while the database held the values.
   *
   * Keyed on the record's identity rather than its contents, so a routine
   * reload of the same record never overwrites something half-typed. React
   * sanctions adjusting state during render like this — same pattern as
   * ClientsPageClient and ConvertToClientDialog, and no effect is needed.
   */
  const [adoptedId, setAdoptedId] = useState(initial?.id ?? null)
  if ((initial?.id ?? null) !== adoptedId) {
    setAdoptedId(initial?.id ?? null)
    setCompanyName(initial?.companyName ?? '')
    setAcnNumber(initial?.acnNumber ?? '')
    setAbnNumber(initial?.abnNumber ?? '')
    setTrustName(initial?.trustName ?? '')
    setPhoneNumber(initial?.phoneNumber ?? '')
    setEmailAddress(initial?.emailAddress ?? '')
    setSaved(!!initial)
    setError('')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSaving(true)

    try {
      const res = await fetch('/api/portal/company-details', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, companyName, acnNumber, abnNumber, trustName, phoneNumber, emailAddress }),
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error ?? 'Failed to save')
        setSaving(false)
        return
      }

      setSaved(true)
      setSaving(false)
      onComplete?.()
    } catch {
      setError('Failed to save. Please try again.')
      setSaving(false)
    }
  }

  function markDirty() {
    setSaved(false)
  }

  /**
   * Fill from a register match picked in one of the two name fields.
   *
   * Every value it writes is one somebody can immediately type over — this form
   * saves on its own button, so a wrong prefill is corrected before anything is
   * stored. Absent keys are left alone rather than blanked: ABR has no ACN for a
   * trust, and wiping one that was already typed would be a loss.
   *
   * Phone and email are untouched, because neither is on the public register.
   */
  function applyLookup(searchedIn: 'companyName' | 'trustName', prefill: AbrPrefill) {
    const next = prefillFor(searchedIn, prefill)

    if (next.companyName !== undefined) setCompanyName(next.companyName)
    if (next.trustName !== undefined) setTrustName(next.trustName)
    if (next.abnNumber) setAbnNumber(next.abnNumber)
    if (next.acnNumber !== undefined) setAcnNumber(next.acnNumber)
    markDirty()
  }

  return (
    <div className="rounded-xl border border-border bg-surface/30 p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-foreground">Company or Trust Details</h3>
        {saved && (
          <span className="flex items-center gap-1 text-xs text-success">
            <CheckCircle className="h-3.5 w-3.5" /> Saved
          </span>
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <EntityNameInput
          id="company-name"
          label="Name of Company"
          value={companyName}
          disabled={saving}
          onChange={(value) => { setCompanyName(value); markDirty() }}
          onPick={(prefill) => applyLookup('companyName', prefill)}
        />
        <div>
          <Input
            id="acn-number"
            label="ACN Number"
            value={acnNumber}
            onChange={(e) => { setAcnNumber(e.target.value); markDirty() }}
          />
          <a
            href="https://connectonline.asic.gov.au/RegistrySearch/faces/landing/SearchRegisters.jspx"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 mt-1.5 text-xs text-accent hover:text-accent/80 transition-colors"
          >
            Look up your ACN number <ExternalLink className="h-3 w-3" />
          </a>
        </div>
        <div>
          <Input
            id="abn-number"
            label="ABN Number"
            value={abnNumber}
            onChange={(e) => { setAbnNumber(e.target.value); markDirty() }}
          />
          <a
            href="https://abr.business.gov.au"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 mt-1.5 text-xs text-accent hover:text-accent/80 transition-colors"
          >
            Look up your ABN number <ExternalLink className="h-3 w-3" />
          </a>
        </div>
        <EntityNameInput
          id="trust-name"
          label="Name of Trust"
          value={trustName}
          disabled={saving}
          onChange={(value) => { setTrustName(value); markDirty() }}
          onPick={(prefill) => applyLookup('trustName', prefill)}
        />
        <Input
          id="company-phone"
          label="Phone Number"
          type="tel"
          value={phoneNumber}
          onChange={(e) => { setPhoneNumber(e.target.value); markDirty() }}
        />
        <Input
          id="company-email"
          label="Email Address"
          type="email"
          value={emailAddress}
          onChange={(e) => { setEmailAddress(e.target.value); markDirty() }}
        />

        {error && <p className="text-xs text-destructive">{error}</p>}

        <Button type="submit" loading={saving} size="sm" disabled={saved}>
          {saved ? 'Details Saved' : 'Save Details'}
        </Button>
      </form>
    </div>
  )
}
