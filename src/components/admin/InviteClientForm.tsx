'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { UserPlus } from 'lucide-react'

interface InviteClientFormProps {
  onSuccess?: () => void
}

export function InviteClientForm({ onSuccess }: InviteClientFormProps) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const res = await fetch('/api/admin/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), email: email.trim().toLowerCase() }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to create client')
      }

      setSuccess(true)
      setName('')
      setEmail('')
      onSuccess?.()
      setTimeout(() => setSuccess(false), 4000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <Input
        label="Client Name"
        id="client-name"
        placeholder="Acme Pty Ltd"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
        className="sm:w-56"
      />
      <Input
        label="Email Address"
        id="client-email"
        type="email"
        placeholder="cfo@acme.com.au"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
        className="sm:w-64"
        error={error ?? undefined}
      />
      <Button type="submit" loading={loading} className="h-10 sm:mb-0">
        <UserPlus className="h-4 w-4" />
        {success ? 'Invite Sent!' : 'Send Invite'}
      </Button>
    </form>
  )
}
