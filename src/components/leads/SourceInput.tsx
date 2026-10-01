'use client'

import { useState } from 'react'
import { Pencil } from 'lucide-react'
import { Select } from '@/components/ui/Select'
import { useToast } from '@/components/ui/Toast'
import { useLeads } from '@/components/leads/LeadsStore'
import { FILTERABLE_SOURCES, SOURCE_META } from '@/lib/leads/constants'
import { formatLeadSource } from '@/lib/leads/format'
import type { Lead, LeadSource } from '@/types/leads'

interface SourceInputProps {
  lead: Lead
  /** 'short' for the phone card's meta line ("FB · EPIC DM"). */
  style?: 'full' | 'short'
}

/**
 * Source, corrected in the row — the same click-to-edit as DebtInput, with a
 * list instead of a text box because a source is one of a fixed few.
 *
 * Only the row's own source changes. Every enquiry's source as delivered stays
 * in lead_submissions, and the delivery id and campaign columns are left as they
 * came in. The partner beside "Facebook" is shown only while the source is
 * Facebook (formatLeadSource).
 *
 * A data correction, not contact: it dispatches UPDATE_LEAD, which writes no
 * activity and leaves the follow-up clock alone.
 */
export function SourceInput({ lead, style = 'full' }: SourceInputProps) {
  const { updateLead } = useLeads()
  const { toast } = useToast()
  const [editing, setEditing] = useState(false)

  // Google Form has no live form, so it is not offered — unless this lead
  // already has it, which the list has to be able to show.
  const options: LeadSource[] = FILTERABLE_SOURCES.includes(lead.source)
    ? FILTERABLE_SOURCES
    : [lead.source, ...FILTERABLE_SOURCES]

  function choose(next: LeadSource) {
    setEditing(false)
    if (next === lead.source) return
    updateLead(lead.id, { source: next })
    toast('Source updated.')
  }

  if (editing) {
    return (
      <div onClick={(event) => event.stopPropagation()}>
        <Select
          autoFocus
          aria-label={`Source for ${lead.name}`}
          value={lead.source}
          selectSize="sm"
          wrapperClassName="min-w-[140px]"
          options={options.map((source) => ({ value: source, label: SOURCE_META[source].label }))}
          onChange={(event) => choose(event.target.value as LeadSource)}
          onBlur={() => setEditing(false)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              setEditing(false)
            }
          }}
        />
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation()
        setEditing(true)
      }}
      aria-label={`Edit source for ${lead.name}`}
      className="group/source inline-flex items-center gap-1.5 rounded px-1 py-0.5 text-left transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <span className="whitespace-nowrap">{formatLeadSource(lead, style)}</span>
      <Pencil className="h-3 w-3 shrink-0 text-muted opacity-0 transition-opacity group-hover/source:opacity-100" />
    </button>
  )
}
