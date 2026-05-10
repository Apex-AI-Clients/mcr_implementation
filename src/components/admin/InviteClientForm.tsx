'use client'

import { useState, useRef } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { UserPlus, Paperclip, X, Mail } from 'lucide-react'

const DEFAULT_MESSAGE = `Thank you for choosing MCR Partners. We have set up a secure portal for you to upload the financial documents required for your preassessment.

Here is what you will need to provide:
• Current Period Profit and Loss & Balance Sheet (PDF)
• Last 4 Years Profit and Loss & Balance Sheet (PDF)
• Integrated Client Account from the ATO Portal (CSV)
• Director Penalty Notices, if applicable (PDF)
• Trust Deed, if applicable (PDF)
• Any Company Licences held (PDF)

Click the button in this email to set up your password and get started. The process takes just a few minutes.`

interface InviteClientFormProps {
  onSuccess?: () => void
}

interface ExistingClientHint {
  id: string
  email: string
}

export function InviteClientForm({ onSuccess }: InviteClientFormProps) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState(DEFAULT_MESSAGE)
  const [attachments, setAttachments] = useState<File[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [existingClient, setExistingClient] = useState<ExistingClientHint | null>(null)
  const [reinviting, setReinviting] = useState(false)
  const [reinviteSent, setReinviteSent] = useState(false)
  const [success, setSuccess] = useState(false)
  const [expanded, setExpanded] = useState(true)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleReinvite() {
    if (!existingClient) return
    setReinviting(true)
    setError(null)
    try {
      // Convert attachments for the reinvite payload too — admins often want
      // to resend the original attachments.
      const attachmentData = await Promise.all(
        attachments.map(async (file) => {
          const buffer = await file.arrayBuffer()
          const base64 = btoa(
            new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), ''),
          )
          return { filename: file.name, content: base64 }
        }),
      )

      const res = await fetch(`/api/admin/clients/${existingClient.id}/reinvite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: message.trim() || undefined,
          attachments: attachmentData.length ? attachmentData : undefined,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to resend invite')
      }
      setReinviteSent(true)
      setTimeout(() => {
        setReinviteSent(false)
        setExistingClient(null)
        setName('')
        setEmail('')
        setMessage(DEFAULT_MESSAGE)
        setAttachments([])
        setExpanded(false)
        onSuccess?.()
      }, 1500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setReinviting(false)
    }
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    const pdfs = files.filter((f) => f.type === 'application/pdf')
    setAttachments((prev) => [...prev, ...pdfs])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function removeAttachment(index: number) {
    setAttachments((prev) => prev.filter((_, i) => i !== index))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setExistingClient(null)
    setLoading(true)

    try {
      // Convert attachments to base64 for the API
      const attachmentData = await Promise.all(
        attachments.map(async (file) => {
          const buffer = await file.arrayBuffer()
          const base64 = btoa(
            new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), ''),
          )
          return { filename: file.name, content: base64 }
        }),
      )

      const trimmedEmail = email.trim().toLowerCase()
      const res = await fetch('/api/admin/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          email: trimmedEmail,
          message: message.trim(),
          attachments: attachmentData,
        }),
      })

      if (res.status === 409) {
        // Look up the existing client so the admin can reinvite inline.
        try {
          const list = await fetch('/api/admin/clients').then((r) => r.json())
          const match = Array.isArray(list)
            ? list.find((c: { email: string }) => c.email?.toLowerCase() === trimmedEmail)
            : null
          if (match) {
            setExistingClient({ id: match.id, email: match.email })
          }
        } catch {
          // Lookup failed — fall back to the plain error message below.
        }
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'A client with this email already exists')
      }

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to create client')
      }

      setSuccess(true)
      setName('')
      setEmail('')
      setMessage(DEFAULT_MESSAGE)
      setAttachments([])
      setExpanded(false)
      onSuccess?.()
      setTimeout(() => setSuccess(false), 4000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <Input
          label="Client Name"
          id="client-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className="sm:w-56"
        />
        <Input
          label="Email Address"
          id="client-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="sm:w-64"
          error={existingClient ? undefined : error ?? undefined}
        />
        <div className="flex gap-2">
          <Button
            type="button"
            variant="ghost"
            size="md"
            className="h-10"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? 'Hide Details' : 'Customise Email'}
          </Button>
          <Button type="submit" loading={loading} className="h-10">
            <UserPlus className="h-4 w-4" />
            {success ? 'Invite Sent!' : 'Send Invite'}
          </Button>
        </div>
      </div>

      {existingClient && (
        <div className="rounded-xl border border-warning/30 bg-warning/5 p-4">
          <p className="text-sm text-foreground">
            A client with <span className="font-medium">{existingClient.email}</span> already exists.
          </p>
          <p className="mt-1 text-xs text-foreground/60">
            You can resend the invite (uses the customised message and attachments below) or open
            the existing client to make changes.
          </p>
          {error && reinviteSent === false && reinviting === false && (
            <p className="mt-2 text-xs text-destructive">{error}</p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              onClick={handleReinvite}
              loading={reinviting}
            >
              <Mail className="h-3.5 w-3.5" />
              {reinviteSent ? 'Invite Resent!' : 'Resend invite'}
            </Button>
            <a
              href={`/admin/clients/${existingClient.id}`}
              className="inline-flex items-center h-8 px-3 text-xs font-medium rounded-lg bg-surface text-muted border border-border hover:text-foreground transition-colors"
            >
              View existing client →
            </a>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setExistingClient(null)
                setError(null)
              }}
            >
              Dismiss
            </Button>
          </div>
        </div>
      )}

      {expanded && (
        <div className="rounded-xl border border-border bg-surface/30 p-4 space-y-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="invite-message" className="text-xs font-medium text-muted">
              Email Message
            </label>
            <textarea
              id="invite-message"
              className="h-48 w-full rounded-lg border border-border bg-input-bg px-3 py-2 text-sm text-foreground placeholder:text-muted transition-colors focus:border-accent focus:outline-none resize-y"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
            <p className="text-[11px] text-muted">
              This text appears in the invite email above the &quot;Set Up Your Account&quot; button.
            </p>
          </div>

          <div>
            <p className="text-xs font-medium text-muted mb-2">PDF Attachments</p>
            {attachments.length > 0 && (
              <div className="space-y-1.5 mb-2">
                {attachments.map((file, i) => (
                  <div
                    key={`${file.name}-${i}`}
                    className="flex items-center gap-2 rounded-lg bg-primary/40 px-3 py-1.5 text-xs"
                  >
                    <Paperclip className="h-3 w-3 text-accent shrink-0" />
                    <span className="text-foreground/70 truncate flex-1">{file.name}</span>
                    <span className="text-foreground/30 shrink-0">
                      {(file.size / 1024).toFixed(0)} KB
                    </span>
                    <button
                      type="button"
                      onClick={() => removeAttachment(i)}
                      className="text-foreground/30 hover:text-destructive transition-colors shrink-0"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              multiple
              onChange={handleFileSelect}
              className="hidden"
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
            >
              <Paperclip className="h-3.5 w-3.5" />
              Attach PDF
            </Button>
          </div>
        </div>
      )}
    </form>
  )
}
