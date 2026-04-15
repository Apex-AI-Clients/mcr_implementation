'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { CheckCircle } from 'lucide-react'
import type { AccountantDetails } from '@/types/app'

interface AccountantDetailsFormProps {
  clientToken: string
  initial: AccountantDetails | null
}

export function AccountantDetailsForm({ clientToken, initial }: AccountantDetailsFormProps) {
  const [companyName, setCompanyName] = useState(initial?.companyName ?? '')
  const [contactPerson, setContactPerson] = useState(initial?.contactPerson ?? '')
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
      const res = await fetch('/api/portal/accountant-details', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-client-token': clientToken,
        },
        body: JSON.stringify({ companyName, contactPerson, phoneNumber, emailAddress }),
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error ?? 'Failed to save')
        setSaving(false)
        return
      }

      setSaved(true)
      setSaving(false)
    } catch {
      setError('Failed to save. Please try again.')
      setSaving(false)
    }
  }

  return (
    <div className="rounded-xl border border-white/8 bg-surface/30 p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-foreground">Current Accountant Details</h3>
        {saved && (
          <span className="flex items-center gap-1 text-xs text-success">
            <CheckCircle className="h-3.5 w-3.5" /> Saved
          </span>
        )}
      </div>
      <p className="text-xs text-foreground/50 mb-4">
        Please provide your current accountant&apos;s contact details.
      </p>

      <form onSubmit={handleSubmit} className="space-y-3">
        <Input
          id="company-name"
          label="Name of Company"
          placeholder="e.g. Smith & Associates"
          value={companyName}
          onChange={(e) => { setCompanyName(e.target.value); setSaved(false) }}
          required
        />
        <Input
          id="contact-person"
          label="Contact Person"
          placeholder="e.g. John Smith"
          value={contactPerson}
          onChange={(e) => { setContactPerson(e.target.value); setSaved(false) }}
          required
        />
        <Input
          id="phone-number"
          label="Phone Number"
          placeholder="e.g. 0412 345 678"
          value={phoneNumber}
          onChange={(e) => { setPhoneNumber(e.target.value); setSaved(false) }}
          required
        />
        <Input
          id="email-address"
          label="Email Address"
          type="email"
          placeholder="e.g. john@smithassociates.com.au"
          value={emailAddress}
          onChange={(e) => { setEmailAddress(e.target.value); setSaved(false) }}
          required
        />

        {error && <p className="text-xs text-destructive">{error}</p>}

        <Button type="submit" loading={saving} size="sm" disabled={saved}>
          {saved ? 'Details Saved' : 'Save Details'}
        </Button>
      </form>
    </div>
  )
}
