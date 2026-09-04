'use client'

import { Select } from '@/components/ui/Select'
import { useToast } from '@/components/ui/Toast'
import { useLeads } from '@/components/leads/LeadsStore'
import { debtSelectOptions, decodeDebtRange } from '@/lib/leads/format'
import type { Lead } from '@/types/leads'

interface DebtSelectProps {
  lead: Lead
  selectSize?: 'sm' | 'md'
  className?: string
}

/**
 * Inline debt control, the same shape as StageSelect so the row reads as one
 * pattern. A native select, so it is keyboard-operable and gets the mobile
 * picker for free.
 *
 * Correcting a debt range is a data correction, not contact: it dispatches
 * UPDATE_LEAD, which writes no activity and leaves `last_action_at` to the
 * database trigger. Changing a debt band must never clear a follow-up flag.
 */
export function DebtSelect({ lead, selectSize = 'sm', className }: DebtSelectProps) {
  const { updateLead } = useLeads()
  const { toast } = useToast()

  // If the lead's range matches no preset — a typed figure from the free-text
  // form, say — it is offered as its own option rather than displayed as
  // "Not given".
  const { options, value } = debtSelectOptions(lead.debtMin, lead.debtMax)

  function handleChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const next = decodeDebtRange(event.target.value)
    if (next.min === lead.debtMin && next.max === lead.debtMax) return

    updateLead(lead.id, { debtMin: next.min, debtMax: next.max })
    toast('Debt updated.')
  }

  return (
    <Select
      aria-label={`Debt for ${lead.name}`}
      value={value}
      onChange={handleChange}
      // The row itself opens the record; the control must not trigger that.
      onClick={(event) => event.stopPropagation()}
      options={options}
      selectSize={selectSize}
      className={className}
    />
  )
}
