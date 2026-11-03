'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { LoadingOverlay } from '@/components/ui/LoadingOverlay'

interface CvlDeleteButtonProps {
  clientId: string
  clientName: string
  /** Where to go once deleted; stays on the page (and refreshes it) when not given. */
  redirectTo?: string
  /** A small icon button for a table row, or a labelled button for a page. */
  compact?: boolean
}

/**
 * "Delete" for a CVL file. As everywhere in the app, nothing is destroyed in
 * one click: the file moves to the Archive (CVL tab), from where it can be
 * made a client again or deleted permanently (POST /api/admin/clients/[id]/archive).
 */
export function CvlDeleteButton({ clientId, clientName, redirectTo, compact = false }: CvlDeleteButtonProps) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function remove() {
    setError(null)
    setWorking(true)
    try {
      const res = await fetch(`/api/admin/clients/${clientId}/archive`, { method: 'POST' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to delete')
      }
      setConfirming(false)
      if (redirectTo) router.push(redirectTo)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setWorking(false)
    }
  }

  return (
    <>
      {compact ? (
        <button
          type="button"
          aria-label={`Delete ${clientName}`}
          title="Delete"
          onClick={() => {
            setError(null)
            setConfirming(true)
          }}
          className="rounded-md p-1.5 text-foreground/40 transition-colors hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setError(null)
            setConfirming(true)
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </Button>
      )}

      <Dialog
        open={confirming}
        onClose={working ? () => {} : () => setConfirming(false)}
        title="Delete this CVL file?"
        description={`${clientName} leaves the CVL client list and moves to the Archive (CVL tab). Its documents, forms and saved PDFs are kept: from the Archive it can be made a client again, or deleted permanently.`}
        footer={
          <>
            <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={working}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" size="sm" onClick={remove} loading={working}>
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </Button>
          </>
        }
      >
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </Dialog>

      {working && <LoadingOverlay label="Deleting…" />}
    </>
  )
}
