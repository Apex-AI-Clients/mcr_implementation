'use client'

import { useEffect, useId, useState } from 'react'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'

/** The column's own limit (lead_stages.label, migration 0042). */
const MAX_LENGTH = 40

interface StageNameDialogProps {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  /** The name to start from, when renaming. */
  initial?: string
  submitLabel: string
  /** Saves the name. A thrown error's message is shown under the field. */
  onSubmit: (label: string) => Promise<void>
}

/**
 * Type a stage's name: to add a stage, or to rename one staff added. The
 * server has the last word (a name already taken comes back as an error and
 * is shown here); this only stops an empty name being sent.
 */
export function StageNameDialog({ open, onClose, title, description, initial = '', submitLabel, onSubmit }: StageNameDialogProps) {
  const fieldId = useId()
  const [label, setLabel] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Fresh each time it opens, not what was typed last time.
  useEffect(() => {
    if (open) {
      setLabel(initial)
      setError(null)
    }
  }, [open, initial])

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const name = label.trim()
    if (!name) {
      setError('Give the stage a name.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onSubmit(name)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not save.')
    } finally {
      setSaving(false)
    }
  }

  const formId = `${fieldId}-form`
  return (
    <Dialog
      open={open}
      onClose={saving ? () => {} : onClose}
      title={title}
      description={description}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={saving}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={handleSubmit}>
        <Input
          id={fieldId}
          label="Stage name"
          value={label}
          maxLength={MAX_LENGTH}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="e.g. Waiting on accountant"
          error={error ?? undefined}
          autoComplete="off"
        />
      </form>
    </Dialog>
  )
}
