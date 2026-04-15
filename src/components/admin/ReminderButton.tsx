'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Send } from 'lucide-react'
import { formatDate } from '@/lib/utils'

interface ReminderButtonProps {
  clientId: string
  lastSentAt: string | null
}

export function ReminderButton({ clientId, lastSentAt }: ReminderButtonProps) {
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function sendReminder() {
    setError(null)
    setLoading(true)

    try {
      const res = await fetch(`/api/admin/clients/${clientId}/send-reminder`, {
        method: 'POST',
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to send reminder')
      }
      setSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <Button
        variant="ghost"
        size="sm"
        loading={loading}
        onClick={sendReminder}
        disabled={sent}
      >
        <Send className="h-3.5 w-3.5" />
        {sent ? 'Reminder Sent' : 'Send Reminder'}
      </Button>
      {lastSentAt && (
        <p className="text-xs text-foreground/35 text-center">
          Last sent {formatDate(lastSentAt)}
        </p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
