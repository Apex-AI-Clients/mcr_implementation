'use client'

import { useState } from 'react'
import { Check, Pencil, X } from 'lucide-react'
import { useToast } from '@/components/ui/Toast'
import { useLeads } from '@/components/leads/LeadsStore'
import { formatLeadSource } from '@/lib/leads/format'
import type { Lead } from '@/types/leads'

interface SourceInputProps {
  lead: Lead
  /** 'short' for the phone card's meta line ("FB · EPIC DM"). */
  style?: 'full' | 'short'
}

const MAX_LENGTH = 100

/**
 * Source, typed in the row — the same click-to-edit as DebtInput. Anything can
 * be entered ("Referral — Dave", "Trade show").
 *
 * What is typed is stored as `sourceLabel` and shown instead of the delivered
 * source. The delivered `source` is never changed here: filters, delivery
 * dedup and ingest keep using it, and every enquiry's source stays in
 * lead_submissions. Clearing the field goes back to the delivered source.
 *
 * A data correction, not contact: it dispatches UPDATE_LEAD, which writes no
 * activity and leaves the follow-up clock alone.
 */
export function SourceInput({ lead, style = 'full' }: SourceInputProps) {
  const { updateLead } = useLeads()
  const { toast } = useToast()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const delivered = formatLeadSource({ ...lead, sourceLabel: null })

  function begin() {
    setDraft(lead.sourceLabel ?? '')
    setEditing(true)
  }

  function cancel() {
    setEditing(false)
  }

  function save() {
    const next = draft.trim() || null
    setEditing(false)
    if (next === lead.sourceLabel) return
    updateLead(lead.id, { sourceLabel: next })
    toast(next === null ? 'Source reset.' : 'Source updated.')
  }

  if (editing) {
    const editor = (
      <>
        <input
          autoFocus
          aria-label={`Source for ${lead.name}`}
          value={draft}
          size={1}
          maxLength={MAX_LENGTH}
          placeholder={delivered}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              save()
            } else if (event.key === 'Escape') {
              event.preventDefault()
              cancel()
            }
          }}
          className="h-7 w-full min-w-0 rounded-lg border border-border bg-input-bg pl-2 pr-12 text-left text-sm text-foreground transition-colors placeholder:text-foreground/40 focus:border-accent focus:outline-none"
        />
        {/* Inside the input's right edge, so the cell is no wider than when
            it shows the label — the table must not grow a horizontal scroll. */}
        <div className="absolute inset-y-0 right-1 flex items-center">
          <button
            type="button"
            onClick={save}
            aria-label={`Save source for ${lead.name}`}
            className="rounded p-0.5 text-success transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Check className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={cancel}
            aria-label={`Cancel editing source for ${lead.name}`}
            className="rounded p-0.5 text-muted transition-colors hover:bg-surface hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </>
    )

    // The phone card's meta line wraps, so it can take a fixed width.
    if (style === 'short') {
      return (
        <div className="relative w-44" onClick={(event) => event.stopPropagation()}>
          {editor}
        </div>
      )
    }

    // In the table, an invisible copy of the label holds the cell at exactly
    // its current width and the editor is laid over it.
    return (
      <div className="relative" onClick={(event) => event.stopPropagation()}>
        <span aria-hidden="true" className="invisible inline-flex items-center gap-1.5 px-1 py-0.5">
          <span className="whitespace-nowrap">{formatLeadSource(lead, style)}</span>
          <span className="h-3 w-3" />
        </span>
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2">{editor}</div>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation()
        begin()
      }}
      aria-label={`Edit source for ${lead.name}`}
      title={lead.sourceLabel ? `Delivered as ${delivered}` : undefined}
      className="group/source inline-flex items-center gap-1.5 rounded px-1 py-0.5 text-left transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <span className="whitespace-nowrap">{formatLeadSource(lead, style)}</span>
      <Pencil className="h-3 w-3 shrink-0 text-muted opacity-0 transition-opacity group-hover/source:opacity-100" />
    </button>
  )
}
