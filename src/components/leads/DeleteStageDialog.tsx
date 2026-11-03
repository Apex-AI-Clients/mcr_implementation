'use client'

import { useEffect, useId, useState } from 'react'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { useLeadStages } from '@/components/leads/LeadStages'
import { stageGroups, stageLabel } from '@/lib/leads/constants'
import type { CustomStageKey, LeadStage } from '@/types/leads'

interface DeleteStageDialogProps {
  open: boolean
  onClose: () => void
  stage: CustomStageKey
  /**
   * Leads in it, as the tab counts them. With filters on, that may be fewer
   * than are really there, so the stage to move them to is asked for anyway.
   */
  leadCount: number
  filtered: boolean
  /** Deletes it. A thrown error's message is shown in the dialog. */
  onDelete: (moveTo: LeadStage) => Promise<void>
}

/**
 * Delete a stage staff added. Its leads need somewhere to go: every other
 * stage is offered except Client, which means making a client file, one lead
 * at a time.
 */
export function DeleteStageDialog({ open, onClose, stage, leadCount, filtered, onDelete }: DeleteStageDialogProps) {
  const selectId = useId()
  const { custom } = useLeadStages()
  const [moveTo, setMoveTo] = useState<LeadStage>('lead')
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (open) {
      setMoveTo('lead')
      setError(null)
    }
  }, [open])

  const groups = stageGroups(custom)
    .map((group) => ({
      label: group.label,
      options: group.stages
        .filter((s) => s !== stage && s !== 'client')
        .map((s) => ({ value: s, label: stageLabel(s, custom) })),
    }))
    .filter((group) => group.options.length > 0)

  async function handleDelete() {
    setDeleting(true)
    setError(null)
    try {
      await onDelete(moveTo)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not save.')
    } finally {
      setDeleting(false)
    }
  }

  const name = stageLabel(stage, custom)
  const description =
    leadCount > 0
      ? `Its tab goes. The ${leadCount} lead${leadCount === 1 ? '' : 's'} in it${filtered ? ' matching these filters, and any others,' : ''} move to the stage you choose, each with an entry in its activity.`
      : filtered
        ? 'Its tab goes. Any leads in it move to the stage you choose.'
        : 'Its tab goes. No leads are in it.'

  return (
    <Dialog
      open={open}
      onClose={deleting ? () => {} : onClose}
      title={`Delete "${name}"?`}
      description={description}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose} disabled={deleting}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" onClick={handleDelete} loading={deleting}>
            Delete stage
          </Button>
        </>
      }
    >
      {(leadCount > 0 || filtered) && (
        <Select
          id={selectId}
          label="Move its leads to"
          value={moveTo}
          onChange={(event) => setMoveTo(event.target.value as LeadStage)}
          groups={groups}
        />
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
    </Dialog>
  )
}
