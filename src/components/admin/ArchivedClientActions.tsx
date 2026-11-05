'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { RotateCcw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Input } from '@/components/ui/Input'
import { LoadingOverlay } from '@/components/ui/LoadingOverlay'
import { clientBase, type ClientWorkspace } from '@/lib/clients/workspace'

interface ArchivedClientActionsProps {
  clientId: string
  clientName: string
  clientEmail: string
  /** The workspace the file goes back to when made a client again. */
  workflow?: ClientWorkspace
  /** Still in CVL (archived from SBR only): it cannot be deleted permanently from here. */
  inCvl?: boolean
}

/**
 * The two ways out of the Archive.
 *
 *   Make client again   back on its own workspace's client list (SBR or CVL),
 *                       exactly as it was archived
 *   Delete permanently  the file, its documents and storage objects, and its
 *                       company and accountant details. Asks for the name,
 *                       because it cannot be undone. Not while the file is
 *                       still in CVL: it is removed from CVL first.
 */
export function ArchivedClientActions({
  clientId,
  clientName,
  clientEmail,
  workflow = 'sbr',
  inCvl = false,
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
      router.push(clientBase(clientId, workflow))
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
          disabled={restoring || inCvl}
          title={inCvl ? 'Still in CVL: remove it from CVL first.' : undefined}
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

      {inCvl && <p className="mt-2 text-xs text-foreground/50">Delete permanently is not available while the file is still in CVL.</p>}
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

      {/* Both stay up through the navigation that follows: each flag is only cleared on a failure. */}
      {restoring && <LoadingOverlay label="Making client again…" />}
      {deleting && <LoadingOverlay label="Deleting client…" />}
    </>
  )
}
