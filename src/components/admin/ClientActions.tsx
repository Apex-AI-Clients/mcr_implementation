'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Mail, Trash2, AlertTriangle, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'

interface ClientActionsProps {
  clientId: string
  clientName: string
  clientEmail: string
}

export function ClientActions({ clientId, clientName, clientEmail }: ClientActionsProps) {
  const router = useRouter()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmName, setConfirmName] = useState('')
  const [reinviteState, setReinviteState] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleReinvite() {
    setError(null)
    setReinviteState('sending')
    try {
      const res = await fetch(`/api/admin/clients/${clientId}/reinvite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to resend invite')
      }
      setReinviteState('sent')
      setTimeout(() => setReinviteState('idle'), 4000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setReinviteState('idle')
    }
  }

  async function handleDelete() {
    if (confirmName.trim() !== clientName.trim()) {
      setError('Name does not match.')
      return
    }
    setError(null)
    setDeleting(true)
    try {
      const res = await fetch(`/api/admin/clients/${clientId}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to delete client')
      }
      router.push('/admin/clients')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setDeleting(false)
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleReinvite}
          loading={reinviteState === 'sending'}
        >
          <Mail className="h-3.5 w-3.5" />
          {reinviteState === 'sent' ? 'Invite Resent!' : 'Reinvite'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setError(null)
            setConfirmName('')
            setConfirmDelete(true)
          }}
          className="text-destructive hover:text-destructive border-destructive/20 hover:border-destructive/40"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete client
        </Button>
      </div>

      {error && !confirmDelete && (
        <p className="mt-2 text-xs text-destructive">{error}</p>
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="h-9 w-9 rounded-lg bg-destructive/10 flex items-center justify-center shrink-0">
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-foreground">Delete client?</h2>
                  <p className="mt-1 text-xs text-foreground/60 leading-relaxed">
                    This permanently deletes <span className="text-foreground">{clientName}</span>{' '}
                    ({clientEmail}), all uploaded files, accountant and company details, and the
                    auth account. The email can be re-invited afterwards.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="text-foreground/40 hover:text-foreground transition-colors"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-5 space-y-3">
              <Input
                id="confirm-name"
                label={`Type "${clientName}" to confirm`}
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
                autoFocus
                autoComplete="off"
              />
              {error && (
                <p className="text-xs text-destructive">{error}</p>
              )}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setConfirmDelete(false)}
                disabled={deleting}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={handleDelete}
                loading={deleting}
                disabled={confirmName.trim() !== clientName.trim()}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete client
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
