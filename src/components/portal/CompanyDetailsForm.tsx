'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { CheckCircle } from 'lucide-react'

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
  initial: CompanyDetails | null
  onComplete?: () => void
}

export function CompanyDetailsForm({ initial, onComplete }: CompanyDetailsFormProps) {
  const [companyName, setCompanyName] = useState(initial?.companyName ?? '')
  const [acnNumber, setAcnNumber] = useState(initial?.acnNumber ?? '')
  const [abnNumber, setAbnNumber] = useState(initial?.abnNumber ?? '')
  const [trustName, setTrustName] = useState(initial?.trustName ?? '')
  const [phoneNumber, setPhoneNumber] = useState(initial?.phoneNumber ?? '')
  const [emailAddress, setEmailAddress] = useState(initial?.emailAddress ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(!!initial)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSaving(true)

    try {
      const res = await fetch('/api/portal/company-details', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyName, acnNumber, abnNumber, trustName, phoneNumber, emailAddress }),
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
        <Input
          id="company-name"
          label="Name of Company"
          value={companyName}
          onChange={(e) => { setCompanyName(e.target.value); markDirty() }}
        />
        <Input
          id="acn-number"
          label="ACN Number"
          value={acnNumber}
          onChange={(e) => { setAcnNumber(e.target.value); markDirty() }}
        />
        <Input
          id="abn-number"
          label="ABN Number"
          value={abnNumber}
          onChange={(e) => { setAbnNumber(e.target.value); markDirty() }}
        />
        <Input
          id="trust-name"
          label="Name of Trust"
          value={trustName}
          onChange={(e) => { setTrustName(e.target.value); markDirty() }}
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
