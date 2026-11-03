'use client'

import { useState } from 'react'
import { Select } from '@/components/ui/Select'
import { useToast } from '@/components/ui/Toast'
import { useLeads } from '@/components/leads/LeadsStore'
import { useLeadStages } from '@/components/leads/LeadStages'
import { StageNameDialog } from '@/components/leads/StageNameDialog'
import { stageGroups, stageLabel } from '@/lib/leads/constants'
import type { Lead, LeadStage } from '@/types/leads'

interface StageSelectProps {
  lead: Lead
  /** Choosing "Client" hands off to the conversion dialog before committing. */
  onRequestConvert: (lead: Lead) => void
  selectSize?: 'sm' | 'md'
  className?: string
}

/** The last option: not a stage, but a way to type a new one. */
const ADD_STAGE = '__add_stage'

/**
 * Inline stage control. A native select, so it groups with <optgroup> and is
 * keyboard-operable without a custom listbox.
 *
 * The change is applied optimistically by the store and rolled back if
 * persistence fails — Gabby changes several in a row and shouldn't wait.
 *
 * "Add a stage…" at the bottom opens a box to type one; once saved, this lead
 * is moved into it, and the stage gets its own tab.
 */
export function StageSelect({
  lead,
  onRequestConvert,
  selectSize = 'sm',
  className,
}: StageSelectProps) {
  const { changeStage } = useLeads()
  const { custom, addStage } = useLeadStages()
  const { toast } = useToast()
  const [pending, setPending] = useState(false)
  const [adding, setAdding] = useState(false)

  const groups = [
    ...stageGroups(custom).map((group) => ({
      label: group.label,
      options: group.stages.map((stage) => ({ value: stage, label: stageLabel(stage, custom) })),
    })),
    { label: 'New', options: [{ value: ADD_STAGE, label: '+ Add a stage…' }] },
  ]

  async function moveTo(next: LeadStage, label: string) {
    setPending(true)
    try {
      await changeStage(lead.id, next)
      toast(`Stage set to ${label.toLowerCase()}.`)
    } catch {
      toast("That didn't save. The stage has been put back.", { tone: 'error' })
    } finally {
      setPending(false)
    }
  }

  async function handleChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const value = event.target.value
    if (value === lead.stage) return

    if (value === ADD_STAGE) {
      event.target.value = lead.stage
      setAdding(true)
      return
    }
    const next = value as LeadStage

    // Converting writes into the restructuring workspace, so it gets a
    // confirmation step. The select snaps back until the dialog is confirmed.
    if (next === 'client' && !lead.convertedClientId) {
      event.target.value = lead.stage
      onRequestConvert(lead)
      return
    }

    await moveTo(next, stageLabel(next, custom))
  }

  async function handleAdd(label: string) {
    // Thrown errors (a name already taken) show in the dialog.
    const stage = await addStage(label)
    await moveTo(stage.key, stage.label)
  }

  return (
    <>
      <Select
        aria-label={`Stage for ${lead.name}`}
        title={stageLabel(lead.stage, custom)}
        value={lead.stage}
        onChange={handleChange}
        onClick={(event) => event.stopPropagation()}
        disabled={pending}
        groups={groups}
        selectSize={selectSize}
        className={className}
      />
      {/* Its own click handler: the dialog sits inside a row that opens the
          record on click. */}
      <span className="contents" onClick={(event) => event.stopPropagation()}>
        <StageNameDialog
          open={adding}
          onClose={() => setAdding(false)}
          title="Add a stage"
          description={`It gets its own tab on the Leads page, and ${lead.name} is moved into it.`}
          submitLabel="Add stage"
          onSubmit={handleAdd}
        />
      </span>
    </>
  )
}
