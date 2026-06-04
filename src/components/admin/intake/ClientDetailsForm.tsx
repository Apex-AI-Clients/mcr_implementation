'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { CheckCircle } from 'lucide-react'

interface ClientDetailsFormProps {
  /** null when adding a brand-new client; set when editing an existing one. */
  clientId: string | null
  initialName: string
  initialEmail: string
  /** Called after a successful save (existing client) with the saved values. */
  onSaved?: (client: { id: string; name: string; email: string }) => void
}

/**
 * Step 1 of the staff intake wizard — captures the client's name and email.
 *
 * In "new" mode (clientId === null) submitting creates the client record and
 * navigates to the client-scoped intake URL, where the rest of the wizard
 * continues. In "edit" mode it PATCHes the existing client.
 */
export function ClientDetailsForm({
  clientId,
  initialName,
  initialEmail,
  onSaved,
}: ClientDetailsFormProps) {
  const router = useRouter()
  const [name, setName] = useState(initialName)
  const [email, setEmail] = useState(initialEmail)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(Boolean(clientId && initialName && initialEmail))
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSaving(true)

    const payload = { name: name.trim(), email: email.trim().toLowerCase() }

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
        setSaved(true)
        setSaving(false)
        onSaved?.({ id: clientId, name: data.name ?? payload.name, email: data.email ?? payload.email })
      } else {
        const res = await fetch('/api/admin/clients', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
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
        onSaved?.({ id: data.id, name: data.name, email: data.email })
      }
    } catch {
      setError('Failed to save. Please try again.')
      setSaving(false)
    }
  }

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
        Enter the client&apos;s contact email and name to start their intake.
      </p>

      <form onSubmit={handleSubmit} className="space-y-3">
        <Input
          id="client-name"
          label="Client / Company Name"
          value={name}
          onChange={(e) => {
            setName(e.target.value)
            setSaved(false)
          }}
          required
        />
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

        {error && <p className="text-xs text-destructive">{error}</p>}

        <Button type="submit" loading={saving} size="sm" disabled={saved}>
          {saved ? 'Saved' : clientId ? 'Save Details' : 'Create & Continue'}
        </Button>
      </form>
    </div>
  )
}
