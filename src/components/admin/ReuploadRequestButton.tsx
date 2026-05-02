'use client'

import { useState } from 'react'
import { RotateCcw, X, Send } from 'lucide-react'
import { Button } from '@/components/ui/Button'

interface ReuploadRequestButtonProps {
  clientId: string
  documentId: string
  documentName: string
}

export function ReuploadRequestButton({ clientId, documentId, documentName }: ReuploadRequestButtonProps) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  async function handleSend() {
    if (!reason.trim()) {
      setError('Please provide a reason')
      return
    }

    setSending(true)
    setError('')

    try {
      const res = await fetch(`/api/admin/clients/${clientId}/request-reupload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentId, reason: reason.trim() }),
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error ?? 'Failed to send request')
        setSending(false)
        return
      }

      setSent(true)
      setSending(false)
      setTimeout(() => {
        setOpen(false)
        setSent(false)
        setReason('')
      }, 2000)
    } catch {
      setError('Failed to send. Please try again.')
      setSending(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-warning hover:text-warning/80 transition-colors"
        title="Request reupload"
      >
        <RotateCcw className="h-3.5 w-3.5" />
      </button>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setOpen(false)}>
      <div
        className="bg-card border border-border rounded-xl p-6 w-full max-w-md shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-foreground">Request Reupload</h3>
          <button type="button" onClick={() => setOpen(false)} className="text-muted hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="text-xs text-muted mb-2">
          File: <span className="text-foreground">{documentName}</span>
        </p>
        <p className="text-xs text-muted mb-4">
          The client will receive an email asking them to replace this file with the reason you provide below.
        </p>

        <div className="space-y-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="reupload-reason" className="text-xs font-medium text-muted">
              Reason (required)
            </label>
            <textarea
              id="reupload-reason"
              className="h-24 w-full rounded-lg border border-border bg-input-bg px-3 py-2 text-sm text-foreground placeholder:text-muted transition-colors focus:border-accent focus:outline-none resize-none"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <Button
            type="button"
            onClick={handleSend}
            loading={sending}
            disabled={sent}
            size="sm"
            className="w-full"
          >
            <Send className="h-3.5 w-3.5" />
            {sent ? 'Request Sent' : 'Send Reupload Request'}
          </Button>
        </div>
      </div>
    </div>
  )
}
