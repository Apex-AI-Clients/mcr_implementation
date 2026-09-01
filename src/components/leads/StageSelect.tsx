'use client'

import { useState } from 'react'
import { Select } from '@/components/ui/Select'
import { useToast } from '@/components/ui/Toast'
import { useLeads } from '@/components/leads/LeadsStore'
import { STAGE_GROUPS, STAGE_META } from '@/lib/leads/constants'
import type { Lead, LeadStage } from '@/types/leads'

interface StageSelectProps {
  lead: Lead
  /** Choosing "Client" hands off to the conversion dialog before committing. */
  onRequestConvert: (lead: Lead) => void
  selectSize?: 'sm' | 'md'
  className?: string
}

const GROUPS = STAGE_GROUPS.map((group) => ({
  label: group.label,
  options: group.stages.map((stage) => ({ value: stage, label: STAGE_META[stage].label })),
}))

/**
 * Inline stage control. A native select, so it groups with <optgroup> and is
 * keyboard-operable without a custom listbox.
 *
 * The change is applied optimistically by the store and rolled back if
 * persistence fails — Gabby changes several in a row and shouldn't wait.
 */
export function StageSelect({
  lead,
  onRequestConvert,
  selectSize = 'sm',
  className,
}: StageSelectProps) {
  const { changeStage } = useLeads()
  const { toast } = useToast()
  const [pending, setPending] = useState(false)

  async function handleChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const next = event.target.value as LeadStage
    if (next === lead.stage) return

    // Converting writes into the restructuring workspace, so it gets a
    // confirmation step. The select snaps back until the dialog is confirmed.
    if (next === 'client' && !lead.convertedClientId) {
      event.target.value = lead.stage
      onRequestConvert(lead)
      return
    }

    setPending(true)
    try {
      await changeStage(lead.id, next)
      toast(`Stage set to ${STAGE_META[next].label.toLowerCase()}.`)
    } catch {
      toast("That didn't save. The stage has been put back.", { tone: 'error' })
    } finally {
      setPending(false)
    }
  }

  return (
    <Select
      aria-label={`Stage for ${lead.name}`}
      value={lead.stage}
      onChange={handleChange}
      onClick={(event) => event.stopPropagation()}
      disabled={pending}
      groups={GROUPS}
      selectSize={selectSize}
      className={className}
    />
  )
}
