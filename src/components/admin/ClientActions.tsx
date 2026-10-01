'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Archive } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'

interface ClientActionsProps {
  clientId: string
  clientName: string
}

/**
 * "Archive client" on the client page.
 *
 * Used to be a permanent delete. Now it moves the file to the Archive, where it
 * can be made a client again or deleted permanently — so nothing is destroyed
 * from the client page, and the confirmation is a plain yes/no rather than
 * typing the name.
 */
export function ClientActions({ clientId, clientName }: ClientActionsProps) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function archive() {
    setError(null)
    setWorking(true)
    try {
      const res = await fetch(`/api/admin/clients/${clientId}/archive`, { method: 'POST' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to archive client')
      }
      router.push('/sbr/archive')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setWorking(false)
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => {
          setError(null)
          setConfirming(true)
        }}
      >
        <Archive className="h-3.5 w-3.5" />
        Archive client
      </Button>

      <Dialog
        open={confirming}
        onClose={working ? () => {} : () => setConfirming(false)}
        title="Archive this client?"
        description={`${clientName} leaves the client list and moves to the Archive. Nothing is deleted: from the Archive you can make them a client again, or delete them permanently.`}
        footer={
          <>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setConfirming(false)}
              disabled={working}
            >
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={archive} loading={working}>
              <Archive className="h-3.5 w-3.5" />
              Archive client
            </Button>
          </>
        }
      >
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </Dialog>
    </>
  )
}
