'use client'

import { useState } from 'react'
import { ArrowDown, ArrowUp, GripVertical, Trash2 } from 'lucide-react'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { useLeadStages } from '@/components/leads/LeadStages'
import { allViews, isCustomStage, LEAD_VIEWS, viewDef, type LeadView } from '@/lib/leads/constants'
import { STAGE_LABEL_MAX } from '@/lib/leads/customStageLimits'
import type { CustomStageKey, LeadStage } from '@/types/leads'

interface EditStagesDialogProps {
  open: boolean
  onClose: () => void
  /** A stage staff added, to be deleted: the page asks where its leads go. */
  onRequestDelete: (stage: CustomStageKey) => void
  /** After saving: what changed, for the page's toast. */
  onSaved: (message: string) => void
}

interface Row {
  view: LeadView
  stage: LeadStage
  /** The name as the panel opened with it: its tab's name. */
  initial: string
  name: string
}

const stageOf = (view: LeadView): LeadStage => (isCustomStage(view) ? view : LEAD_VIEWS[view].stages[0])

/**
 * "Edit stages" (0055): every tab, in order. Drag a row by its handle (or use
 * its up and down buttons) to reorder the tabs; edit a name to rename the
 * stage, built-in ones included: the new name is used for its tab and the
 * stage everywhere. A stage staff added can be deleted from here too.
 *
 * Nothing is saved until Save. The order applies to the tabs only: the Stage
 * dropdown keeps its Pipeline / Closed / Added by staff groups.
 */
export function EditStagesDialog({ open, onClose, onRequestDelete, onSaved }: EditStagesDialogProps) {
  if (!open) return null
  return <EditStagesBody onClose={onClose} onRequestDelete={onRequestDelete} onSaved={onSaved} />
}

function EditStagesBody({ onClose, onRequestDelete, onSaved }: Omit<EditStagesDialogProps, 'open'>) {
  const { custom, renameStage, reorderStages, refresh } = useLeadStages()
  const [rows, setRows] = useState<Row[]>(() =>
    allViews(custom).map((view) => {
      const name = viewDef(view, custom).label
      return { view, stage: stageOf(view), initial: name, name }
    }),
  )
  const [dragging, setDragging] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const initialOrder = allViews(custom).map(stageOf)
  const reordered = rows.some((row, i) => row.stage !== initialOrder[i])
  const renamed = rows.filter((row) => row.name.trim().replace(/\s+/g, ' ') !== row.initial)
  const invalid = rows.find((row) => !row.name.trim() || row.name.trim().length > STAGE_LABEL_MAX)

  function move(from: number, to: number) {
    if (to < 0 || to >= rows.length || from === to) return
    setRows((current) => {
      const next = [...current]
      const [row] = next.splice(from, 1)
      next.splice(to, 0, row)
      return next
    })
  }

  async function save() {
    if (invalid) {
      setError(`Every stage needs a name of up to ${STAGE_LABEL_MAX} characters.`)
      return
    }
    setSaving(true)
    setError(null)
    try {
      for (const row of renamed) await renameStage(row.stage, row.name.trim().replace(/\s+/g, ' '), { refresh: false })
      if (reordered) await reorderStages(rows.map((row) => row.stage), { refresh: false })
      refresh()
      const parts = [
        renamed.length ? `${renamed.length} stage${renamed.length === 1 ? '' : 's'} renamed` : '',
        reordered ? 'tab order saved' : '',
      ].filter(Boolean)
      onSaved(parts.length ? `${parts.join(', ')}.`.replace(/^./, (c) => c.toUpperCase()) : 'Nothing changed.')
      onClose()
    } catch (err) {
      // A rename may have saved before the error: re-read so the page shows it.
      refresh()
      setError(err instanceof Error ? err.message : 'That did not save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open
      onClose={saving ? () => {} : onClose}
      title="Edit stages"
      description="Drag a stage, or use its arrows, to change the order of the tabs. Change a name to rename the stage: its tab and every lead in it show the new name."
      className="max-w-lg"
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" onClick={save} loading={saving} disabled={!reordered && renamed.length === 0}>
            Save
          </Button>
        </>
      }
    >
      <ol aria-label="Stages, in tab order" className="max-h-[60vh] space-y-1.5 overflow-y-auto pr-1">
        {rows.map((row, i) => {
          const id = `stage-name-${row.stage}`
          return (
            <li
              key={row.stage}
              draggable={!saving}
              onDragStart={(event) => {
                setDragging(i)
                event.dataTransfer.effectAllowed = 'move'
              }}
              onDragOver={(event) => {
                if (dragging === null) return
                event.preventDefault()
                if (dragging !== i) {
                  move(dragging, i)
                  setDragging(i)
                }
              }}
              onDragEnd={() => setDragging(null)}
              onDrop={(event) => {
                event.preventDefault()
                setDragging(null)
              }}
              className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 ${
                dragging === i ? 'border-accent/50 bg-accent/10' : 'border-border bg-card'
              }`}
            >
              <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-foreground/40" aria-hidden="true" />
              <label htmlFor={id} className="sr-only">
                Name of stage {i + 1}
              </label>
              <input
                id={id}
                value={row.name}
                maxLength={STAGE_LABEL_MAX + 10}
                disabled={saving}
                onChange={(event) =>
                  setRows((current) => current.map((r) => (r.stage === row.stage ? { ...r, name: event.target.value } : r)))
                }
                className="h-8 min-w-0 flex-1 rounded-md border border-border bg-input-bg px-2 text-sm text-foreground focus:border-accent focus:outline-none"
              />
              <button
                type="button"
                aria-label={`Move ${row.name || 'this stage'} up`}
                disabled={saving || i === 0}
                onClick={() => move(i, i - 1)}
                className="rounded p-1 text-foreground/50 hover:bg-surface hover:text-foreground disabled:opacity-30"
              >
                <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label={`Move ${row.name || 'this stage'} down`}
                disabled={saving || i === rows.length - 1}
                onClick={() => move(i, i + 1)}
                className="rounded p-1 text-foreground/50 hover:bg-surface hover:text-foreground disabled:opacity-30"
              >
                <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              {isCustomStage(row.stage) ? (
                <button
                  type="button"
                  aria-label={`Delete ${row.initial}`}
                  disabled={saving}
                  onClick={() => onRequestDelete(row.stage as CustomStageKey)}
                  className="rounded p-1 text-foreground/50 hover:bg-destructive/10 hover:text-destructive disabled:opacity-30"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              ) : (
                // Built-in stages cannot be deleted: the space keeps the rows lined up.
                <span className="w-[22px] shrink-0" aria-hidden="true" />
              )}
            </li>
          )
        })}
      </ol>
      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
    </Dialog>
  )
}
