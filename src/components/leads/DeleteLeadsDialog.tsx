'use client'

import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { useLeads } from '@/components/leads/LeadsStore'
import type { Lead } from '@/types/leads'

interface DeleteLeadsDialogProps {
  /** The leads to delete. Empty or null closes the dialog. */
  leads: Lead[] | null
  onClose: () => void
  /** Called after the database has confirmed the delete. */
  onDeleted?: (ids: string[]) => void
}

/** How many names to spell out before falling back to a count. */
const NAMES_SHOWN = 5

/**
 * Confirmation for deleting leads.
 *
 * Deliberately not a browser confirm(): this has to say what else goes with
 * the lead. The timeline cascades, the Meta attribution cannot be re-fetched
 * once the leadgen id has been consumed, and a converted lead leaves its
 * client file behind but loses the link back to it. None of that is obvious
 * from "Are you sure?".
 */
export function DeleteLeadsDialog({ leads, onClose, onDeleted }: DeleteLeadsDialogProps) {
  const { deleteLeads } = useLeads()
  const { toast } = useToast()
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset when a different selection is opened — the same adjust-during-render
  // pattern ConvertToClientDialog uses, so no effect is needed.
  const key = (leads ?? []).map((lead) => lead.id).join(',')
  const [prevKey, setPrevKey] = useState(key)
  if (key !== prevKey) {
    setPrevKey(key)
    setWorking(false)
    setError(null)
  }

  const open = !!leads && leads.length > 0
  const count = leads?.length ?? 0
  const converted = (leads ?? []).filter((lead) => lead.convertedClientId !== null)

  async function handleDelete() {
    if (!leads || leads.length === 0) return
    setWorking(true)
    setError(null)
    try {
      const ids = leads.map((lead) => lead.id)
      await deleteLeads(ids)
      toast(count === 1 ? 'Lead deleted.' : `${count} leads deleted.`)
      onDeleted?.(ids)
      onClose()
    } catch (err) {
      // Nothing has been removed from the list — the store only applies the
      // change after the database confirms it — so the dialog stays open with
      // the reason rather than closing on a lie.
      setError(err instanceof Error ? err.message : 'Could not delete. Nothing was changed.')
      setWorking(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={working ? () => {} : onClose}
      title={count === 1 ? 'Delete this lead?' : `Delete ${count} leads?`}
      description="This cannot be undone."
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose} disabled={working}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" onClick={handleDelete} loading={working}>
            {count === 1 ? 'Delete lead' : `Delete ${count} leads`}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm text-foreground/70">
        {count <= NAMES_SHOWN ? (
          <ul className="space-y-1">
            {(leads ?? []).map((lead) => (
              <li key={lead.id} className="truncate">
                <span className="font-medium text-foreground">{lead.name}</span>
                <span className="text-foreground/50"> · {lead.email}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p>
            <span className="font-medium text-foreground">{count} leads</span> will be removed,
            including {(leads ?? [])[0]?.name} and {count - 1} others.
          </p>
        )}

        <p>
          Their full history — every note, call and stage change — goes with them, and so does
          the Facebook attribution, which cannot be fetched again.
        </p>

        {converted.length > 0 && (
          <div className="flex gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-warning">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <p>
              {converted.length === 1
                ? 'One of these has a client file in the restructuring workspace.'
                : `${converted.length} of these have client files in the restructuring workspace.`}{' '}
              The {converted.length === 1 ? 'file stays' : 'files stay'} where{' '}
              {converted.length === 1 ? 'it is' : 'they are'}, but the link back to the lead will
              be lost.
            </p>
          </div>
        )}

        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  )
}
