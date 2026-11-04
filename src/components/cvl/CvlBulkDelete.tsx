'use client'

import { createContext, useContext, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { LoadingOverlay } from '@/components/ui/LoadingOverlay'

/**
 * Ticking several CVL clients and deleting them together, as on the SBR
 * client list. As the single Delete, nothing is destroyed: each file moves to
 * the Archive (CVL tab), from where it can be made a client again or deleted
 * permanently (POST /api/admin/clients/[id]/archive).
 *
 * The table stays a server component: it places a CvlSelectAll and a
 * CvlRowCheckbox, and this provider holds what is ticked.
 */

interface Row {
  id: string
  name: string
}

interface Selection {
  rows: Row[]
  selected: Set<string>
  toggle: (id: string) => void
  toggleAll: () => void
}

const SelectionContext = createContext<Selection | null>(null)

function useSelection(): Selection {
  const s = useContext(SelectionContext)
  if (!s) throw new Error('CVL selection used outside CvlSelectionProvider')
  return s
}

export function CvlSelectionProvider({ rows, children }: { rows: Row[]; children: React.ReactNode }) {
  const router = useRouter()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirming, setConfirming] = useState(false)
  const [working, setWorking] = useState(false)
  // The list is read again after deleting; the wait screen stays up until it lands.
  const [refreshing, startRefresh] = useTransition()
  const [error, setError] = useState<string | null>(null)

  // Only rows on this page count (a search or page change leaves the others).
  const ticked = rows.filter((r) => selected.has(r.id))
  const allTicked = rows.length > 0 && ticked.length === rows.length

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const toggleAll = () => setSelected(allTicked ? new Set() : new Set(rows.map((r) => r.id)))

  async function remove() {
    setWorking(true)
    setError(null)
    const results = await Promise.all(
      ticked.map((r) =>
        fetch(`/api/admin/clients/${r.id}/archive`, { method: 'POST' })
          .then((res) => res.ok)
          .catch(() => false),
      ),
    )
    const failed = results.filter((ok) => !ok).length
    if (failed > 0) {
      setError(failed === ticked.length ? 'Could not be deleted. Please try again.' : `${failed} of ${ticked.length} could not be deleted. Please retry.`)
    }
    setWorking(false)
    setConfirming(false)
    setSelected(new Set())
    startRefresh(() => router.refresh())
  }

  const count = ticked.length
  const names = ticked.map((r) => r.name).join(', ')

  return (
    <SelectionContext.Provider value={{ rows, selected, toggle, toggleAll }}>
      <div className="space-y-3">
        {error && <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">{error}</div>}
        {count > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-accent/30 bg-accent/5 px-4 py-2.5">
            <span className="text-sm text-foreground/80">{count} selected</span>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                Clear
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={() => {
                  setError(null)
                  setConfirming(true)
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete selected
              </Button>
            </div>
          </div>
        )}
        {children}
      </div>

      <Dialog
        open={confirming}
        onClose={working ? () => {} : () => setConfirming(false)}
        title={count === 1 ? 'Delete this CVL file?' : `Delete ${count} CVL files?`}
        description={`${names} ${count === 1 ? 'leaves' : 'leave'} the CVL client list and ${count === 1 ? 'moves' : 'move'} to the Archive (CVL tab). Documents, forms and saved PDFs are kept: from the Archive ${count === 1 ? 'it' : 'each'} can be made a client again, or deleted permanently.`}
        footer={
          <>
            <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={working}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" size="sm" onClick={remove} loading={working}>
              <Trash2 className="h-3.5 w-3.5" />
              {count === 1 ? 'Delete' : `Delete ${count}`}
            </Button>
          </>
        }
      >
        {null}
      </Dialog>
      {(working || refreshing) && <LoadingOverlay label={count > 1 ? `Deleting ${count} CVL files…` : 'Deleting…'} />}
    </SelectionContext.Provider>
  )
}

export function CvlSelectAll() {
  const { rows, selected, toggleAll } = useSelection()
  const all = rows.length > 0 && rows.every((r) => selected.has(r.id))
  return <input type="checkbox" aria-label="Select all clients on this page" checked={all} onChange={toggleAll} className="accent-accent" />
}

export function CvlRowCheckbox({ id, name }: { id: string; name: string }) {
  const { selected, toggle } = useSelection()
  return <input type="checkbox" aria-label={`Select ${name}`} checked={selected.has(id)} onChange={() => toggle(id)} className="accent-accent" />
}
