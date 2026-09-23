'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { EntityNameInput } from '@/components/abr/EntityNameInput'
import type { AbrPrefill } from '@/lib/abr/types'
import { CheckCircle } from 'lucide-react'

interface ClientDetailsFormProps {
  /** null when adding a brand-new client; set when editing an existing one. */
  clientId: string | null
  initialName: string
  initialEmail: string
  /** Optional — a client can be created before their number is known. */
  initialPhone?: string
  /** Called after a successful save (existing client) with the saved values. */
  onSaved?: (client: { id: string; name: string; email: string; phone: string | null }) => void
}

/**
 * Step 1 of the staff intake wizard — captures the client's name, email and
 * phone. Phone is optional; name and email are what unlock the later steps.
 *
 * In "new" mode (clientId === null) submitting creates the client record and
 * navigates to the client-scoped intake URL, where the rest of the wizard
 * continues. In "edit" mode it PATCHes the existing client.
 *
 * The name field searches the Australian Business Register, and what it finds
 * is kept in both modes — the ABN and ACN behind a picked name are saved with
 * the client, so the company step opens already filled rather than asking again
 * for what the register just answered. Nothing is hidden: what will be saved is
 * shown under the field before you save it.
 *
 * Creating sends them with the create call. Editing writes them separately,
 * after the name save, as a partial update that leaves the phone number and
 * email on that record alone — neither is on any register, so this step has no
 * business having an opinion about them. See src/lib/clients/companyDetails.ts.
 */
export function ClientDetailsForm({
  clientId,
  initialName,
  initialEmail,
  initialPhone = '',
  onSaved,
}: ClientDetailsFormProps) {
  const router = useRouter()
  const [name, setName] = useState(initialName)
  const [email, setEmail] = useState(initialEmail)
  const [phone, setPhone] = useState(initialPhone)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(Boolean(clientId && initialName && initialEmail))
  const [error, setError] = useState('')
  /**
   * The register details behind the name currently in the box, when it came
   * from a pick. Dropped the moment the name is edited by hand: keeping it
   * would file company A's ABN against a client somebody renamed to company B.
   */
  const [picked, setPicked] = useState<AbrPrefill | null>(null)

  function handleNameChange(value: string) {
    setName(value)
    setPicked(null)
    setSaved(false)
  }

  function handlePick(prefill: AbrPrefill) {
    // One field, so whichever name the register answered with goes in it.
    setName(prefill.companyName || prefill.trustName || '')
    setPicked(prefill)
    setSaved(false)
  }

  /**
   * What the register answered, as the company_details fields.
   *
   * Only ever the keys ABR actually filled — an absent key means "leave that
   * column alone", which is what keeps this safe to send against an existing
   * record. Phone and email are never here.
   */
  function companyDetailsPayload() {
    if (!picked) return undefined
    const payload: Record<string, string> = { abnNumber: picked.abnNumber }
    if (picked.companyName !== undefined) payload.companyName = picked.companyName
    if (picked.trustName !== undefined) payload.trustName = picked.trustName
    if (picked.acnNumber !== undefined) payload.acnNumber = picked.acnNumber
    return payload
  }

  /** Partial write — only the register's own fields. Never phone or email. */
  async function saveCompanyDetails(id: string, details: Record<string, string>) {
    try {
      const res = await fetch('/api/portal/company-details', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: id, ...details }),
      })
      return res.ok
    } catch {
      return false
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSaving(true)

    const payload = {
      name: name.trim(),
      email: email.trim().toLowerCase(),
      // Always sent, so clearing the field on an edit clears the stored number.
      phone: phone.trim(),
    }

    try {
      if (clientId) {
        const res = await fetch(`/api/admin/clients/${clientId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          setError(data.error ?? 'Failed to save')
          setSaving(false)
          return
        }

        // Second write, because the client row and the company record are two
        // tables. The name is already saved by this point, so a failure here is
        // reported without pretending the whole save failed — the numbers can
        // be typed on the company step.
        const details = companyDetailsPayload()
        if (details) {
          const ok = await saveCompanyDetails(clientId, details)
          if (!ok) {
            setError('Name saved. The ABN could not be saved — add it on the company step.')
            setSaved(true)
            setSaving(false)
            onSaved?.({
              id: clientId,
              name: data.name ?? payload.name,
              email: data.email ?? payload.email,
              phone: data.phone ?? null,
            })
            return
          }
        }

        setSaved(true)
        setSaving(false)
        onSaved?.({
          id: clientId,
          name: data.name ?? payload.name,
          email: data.email ?? payload.email,
          phone: data.phone ?? null,
        })
      } else {
        const companyDetails = companyDetailsPayload()
        const res = await fetch('/api/admin/clients', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(companyDetails ? { ...payload, companyDetails } : payload),
        })
        const data = await res.json().catch(() => ({}))
        if (res.status === 409) {
          setError(
            data.clientId
              ? 'A client with this email already exists. Open it from the clients list to continue.'
              : (data.error ?? 'A client with this email already exists'),
          )
          setSaving(false)
          return
        }
        if (!res.ok) {
          setError(data.error ?? 'Failed to create client')
          setSaving(false)
          return
        }
        setSaved(true)
        // Continue the wizard at the client-scoped URL (keeps saving spinner
        // until the new page mounts).
        router.replace(`/clients/${data.id}/intake`)
        onSaved?.({ id: data.id, name: data.name, email: data.email, phone: data.phone ?? null })
      }
    } catch {
      setError('Failed to save. Please try again.')
      setSaving(false)
    }
  }

  const carriedForward = picked

  return (
    <div className="rounded-xl border border-border bg-surface/30 p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Client Details</h3>
        {saved && (
          <span className="flex items-center gap-1 text-xs text-success">
            <CheckCircle className="h-3.5 w-3.5" /> Saved
          </span>
        )}
      </div>
      <p className="mb-4 text-xs text-foreground/50">
        Enter the client&apos;s name, email and phone to start their intake.
      </p>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="space-y-1.5">
          <EntityNameInput
            id="client-name"
            label="Client / Company Name"
            value={name}
            disabled={saving}
            required
            onChange={handleNameChange}
            onPick={handlePick}
          />
          {/* A pick writes more than the field shows, so the field says so.
              A silent side effect on a create is not something to discover
              two steps later on the company form. */}
          {carriedForward && (
            <p className="text-xs text-foreground/50">
              ABN <span className="tabular-nums">{picked.abnNumber}</span>
              {picked.acnNumber ? (
                <>
                  {' '}
                  and ACN <span className="tabular-nums">{picked.acnNumber}</span>
                </>
              ) : null}{' '}
              will be saved with this client. Editable on the company step.
            </p>
          )}
        </div>
        <Input
          id="client-email"
          label="Email Address"
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value)
            setSaved(false)
          }}
          required
        />
        <Input
          id="client-phone"
          label="Phone Number"
          type="tel"
          autoComplete="tel"
          value={phone}
          onChange={(e) => {
            setPhone(e.target.value)
            setSaved(false)
          }}
        />

        {error && <p className="text-xs text-destructive">{error}</p>}

        <Button type="submit" loading={saving} size="sm" disabled={saved}>
          {saved ? 'Saved' : clientId ? 'Save Details' : 'Create & Continue'}
        </Button>
      </form>
    </div>
  )
}
