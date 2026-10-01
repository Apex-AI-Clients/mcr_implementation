'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { RotateCcw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Input } from '@/components/ui/Input'

interface ArchivedClientActionsProps {
  clientId: string
  clientName: string
  clientEmail: string
}

/**
 * The two ways out of the Archive.
 *
 *   Make client again   back on the client list, exactly as it was archived
 *   Delete permanently  the file, its documents and storage objects, and its
 *                       company and accountant details. Asks for the name,
 *                       because it cannot be undone.
 */
export function ArchivedClientActions({
  clientId,
  clientName,
  clientEmail,
}: ArchivedClientActionsProps) {
  const router = useRouter()
  const [restoring, setRestoring] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmName, setConfirmName] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const nameMatches = confirmName.trim() === clientName.trim()

  async function restore() {
    setError(null)
    setRestoring(true)
    try {
      const res = await fetch(`/api/admin/clients/${clientId}/restore`, { method: 'POST' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to restore client')
      }
      router.push(`/clients/${clientId}`)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setRestoring(false)
    }
  }

  async function deletePermanently() {
    if (!nameMatches) return
    setError(null)
    setDeleting(true)
    try {
      const res = await fetch(`/api/admin/clients/${clientId}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to delete client')
      }
      router.push('/sbr/archive')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setDeleting(false)
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" onClick={restore} loading={restoring} disabled={deleting}>
          <RotateCcw className="h-3.5 w-3.5" />
          Make client again
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={restoring}
          onClick={() => {
            setError(null)
            setConfirmName('')
            setConfirmDelete(true)
          }}
          className="text-destructive hover:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete permanently
        </Button>
      </div>

      {error && !confirmDelete && <p className="mt-2 text-xs text-destructive">{error}</p>}

      <Dialog
        open={confirmDelete}
        onClose={deleting ? () => {} : () => setConfirmDelete(false)}
        title="Delete permanently?"
        description={`This permanently deletes ${clientName} (${clientEmail}), along with all uploaded files and their accountant and company details. This cannot be undone.`}
        footer={
          <>
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
              onClick={deletePermanently}
              loading={deleting}
              disabled={!nameMatches}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete permanently
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Input
            id="confirm-name"
            label={`Type "${clientName}" to confirm`}
            value={confirmName}
            onChange={(event) => setConfirmName(event.target.value)}
            autoComplete="off"
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      </Dialog>
    </>
  )
}
