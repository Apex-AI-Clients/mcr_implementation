'use client'

import { createContext, useContext, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { LoadingOverlay } from '@/components/ui/LoadingOverlay'

/**
 * Ticking several CVL clients and deleting them together, as on the SBR
 * client list. As the single Delete, nothing is destroyed: each file leaves
 * the CVL list (POST /api/admin/cvl/[caseId]/remove). One also in SBR stays
 * on the SBR list; a CVL-only file moves to the Archive (CVL tab), from where
 * it can be made a client again or deleted permanently.
 *
 * The table stays a server component: it places a CvlSelectAll and a
 * CvlRowCheckbox, and this provider holds what is ticked.
 */

interface Row {
  /** The file's CVL case. */
  id: string
  name: string
  /** Also on the SBR list: it stays there. */
  inSbr: boolean
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
        fetch(`/api/admin/cvl/${r.id}/remove`, { method: 'POST' })
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
        description={bulkDescription(ticked)}
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

/** What happens to the ticked files, said for those also in SBR and those not. */
function bulkDescription(ticked: Row[]): string {
  const names = (rows: Row[]) => rows.map((r) => r.name).join(', ')
  const both = ticked.filter((r) => r.inSbr)
  const only = ticked.filter((r) => !r.inSbr)
  const parts: string[] = []
  if (only.length) {
    parts.push(
      `${names(only)} ${only.length === 1 ? 'leaves' : 'leave'} the CVL client list and ${only.length === 1 ? 'moves' : 'move'} to the Archive (CVL tab); from there ${only.length === 1 ? 'it' : 'each'} can be made a client again, or deleted permanently.`,
    )
  }
  if (both.length) {
    parts.push(`${names(both)} ${both.length === 1 ? 'leaves' : 'leave'} the CVL client list and ${both.length === 1 ? 'stays' : 'stay'} on the SBR list.`)
  }
  return `${parts.join(' ')} Documents, forms and saved PDFs are kept.`
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
