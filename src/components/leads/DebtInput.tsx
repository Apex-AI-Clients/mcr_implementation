'use client'

import { useState } from 'react'
import { Check, Pencil, X } from 'lucide-react'
import { useToast } from '@/components/ui/Toast'
import { useLeads } from '@/components/leads/LeadsStore'
import { parseLooseDebt, type LooseDebtFailure } from '@/lib/leads/ingest'
import { formatDebtRange } from '@/lib/leads/format'
import { MIN_PLAUSIBLE_DEBT } from '@/lib/leads/ingestConfig'
import type { Lead } from '@/types/leads'

interface DebtInputProps {
  lead: Lead
  /** Rendered in the mobile card, where there is room for a full-width field. */
  variant?: 'row' | 'card'
}

const FAILURE_MESSAGE: Record<LooseDebtFailure, string> = {
  not_a_number: 'Enter an amount, e.g. 120000 or $120k.',
  ambiguous: 'Enter one amount, not a range.',
  too_small: `Enter at least $${MIN_PLAUSIBLE_DEBT.toLocaleString('en-AU')}.`,
}

/**
 * Debt, edited in the row as an exact figure.
 *
 * The capture forms can only ever give a bracket. Once Gabby has spoken to
 * someone he knows the real number, and typing it should not mean picking the
 * nearest band — so this takes a figure and stores it as a point range
 * (min === max), which formatDebtRange renders as a single amount.
 *
 * Accepts what people actually type: "120000", "$120,000", "120k". Clearing the
 * field sets the debt back to unknown. Anything it cannot read is refused with
 * a reason rather than guessed at.
 *
 * Correcting a figure is a data correction, not contact: it dispatches
 * UPDATE_LEAD, which writes no activity and leaves `last_action_at` to the
 * database trigger. Editing debt must never clear a follow-up flag.
 */
export function DebtInput({ lead, variant = 'row' }: DebtInputProps) {
  const { updateLead } = useLeads()
  const { toast } = useToast()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  const isExact = lead.debtMin !== null && lead.debtMin === lead.debtMax
  const display = formatDebtRange(lead.debtMin, lead.debtMax)

  function begin() {
    // Prefill only when the stored value is already an exact figure. Prefilling
    // the floor of a bracket would let a stray Enter turn "$100k – $125k" into
    // exactly $100,000 without anyone deciding that.
    setDraft(isExact ? String(lead.debtMin) : '')
    setError(null)
    setEditing(true)
  }

  function cancel() {
    setEditing(false)
    setError(null)
  }

  function save() {
    const parsed = parseLooseDebt(draft)

    if (parsed.kind === 'unparseable') {
      setError(FAILURE_MESSAGE[parsed.reason])
      return
    }

    const next =
      parsed.kind === 'absent'
        ? { debtMin: null, debtMax: null }
        : { debtMin: parsed.min, debtMax: parsed.max }

    if (next.debtMin === lead.debtMin && next.debtMax === lead.debtMax) {
      cancel()
      return
    }

    updateLead(lead.id, next)
    setEditing(false)
    setError(null)
    toast(parsed.kind === 'absent' ? 'Debt cleared.' : 'Debt updated.')
  }

  if (editing) {
    return (
      <div onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start gap-1">
          <input
            autoFocus
            inputMode="decimal"
            aria-label={`Debt for ${lead.name}`}
            value={draft}
            placeholder={isExact ? undefined : display}
            onChange={(event) => {
              setDraft(event.target.value)
              setError(null)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                save()
              } else if (event.key === 'Escape') {
                event.preventDefault()
                cancel()
              }
            }}
            className="h-8 w-full min-w-0 rounded-lg border border-border bg-input-bg px-2 text-right text-sm tabular-nums text-foreground transition-colors placeholder:text-foreground/40 focus:border-accent focus:outline-none"
          />
          <button
            type="button"
            onClick={save}
            aria-label={`Save debt for ${lead.name}`}
            className="mt-0.5 rounded-lg p-1 text-success transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Check className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={cancel}
            aria-label={`Cancel editing debt for ${lead.name}`}
            className="mt-0.5 rounded-lg p-1 text-muted transition-colors hover:bg-surface hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        {error && <p className="mt-1 text-xs leading-tight text-destructive">{error}</p>}
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
      aria-label={`Edit debt for ${lead.name}`}
      className={`group/debt flex w-full items-center gap-1.5 rounded px-1 py-0.5 transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
        variant === 'card' ? 'justify-start' : 'justify-end'
      }`}
    >
      <span
        className={`tabular-nums ${
          lead.debtMin === null ? 'text-foreground/25' : 'font-medium text-foreground'
        }`}
      >
        {display}
      </span>
      <Pencil className="h-3 w-3 shrink-0 text-muted opacity-0 transition-opacity group-hover/debt:opacity-100" />
    </button>
  )
}
