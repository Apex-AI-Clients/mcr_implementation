'use client'

import { AlertTriangle, CheckCircle } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import {
  formatAcn,
  sameIdentityValue,
  type IdentityComparison,
  type IdentityField,
} from '@/lib/asic/fill'
import { formatAbn } from '@/lib/asic/identifiers'

interface AsicComparisonNoteProps {
  field: IdentityField
  /** What the extract said about this field, if an extract is applied. */
  comparison: IdentityComparison | undefined
  /** The field's value now — the note follows edits made after the fill. */
  value: string
  disabled?: boolean
  onChoice: (choice: 'asic' | 'keep') => void
}

function shown(field: IdentityField, value: string): string {
  if (field === 'acnNumber') return formatAcn(value)
  if (field === 'abnNumber') return formatAbn(value)
  return value
}

/**
 * One line under a company name, ACN or ABN field, saying how it stands against
 * the applied ASIC extract:
 *
 *   ✓ Matches ASIC extract           equal, whether typed, filled or chosen
 *   ASIC: X / Form: Y  [Use ASIC] [Keep]   different, and not yet decided
 *   ASIC extract has X               decided "Keep", or edited since
 *
 * Nothing when no extract is applied or the extract had nothing for the field.
 */
export function AsicComparisonNote({
  field,
  comparison,
  value,
  disabled,
  onChoice,
}: AsicComparisonNoteProps) {
  if (!comparison || comparison.status === 'not_on_extract') return null

  if (comparison.status === 'differs') {
    return (
      <div
        role="group"
        aria-label="The ASIC extract has a different value"
        className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-warning/30 bg-warning/10 px-2.5 py-1.5 text-xs text-foreground/80"
      >
        <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          ASIC: <span className="tabular-nums">{shown(field, comparison.asic)}</span>
          {' / '}
          Form: <span className="tabular-nums">{shown(field, comparison.form)}</span>
        </span>
        <span className="flex gap-1.5">
          <Button type="button" size="sm" disabled={disabled} onClick={() => onChoice('asic')}>
            Use ASIC
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={disabled}
            onClick={() => onChoice('keep')}
          >
            Keep
          </Button>
        </span>
      </div>
    )
  }

  if (value.trim() && sameIdentityValue(field, value, comparison.asic)) {
    return (
      <p className="flex items-center gap-1 text-xs text-success">
        <CheckCircle className="h-3.5 w-3.5" aria-hidden="true" />
        Matches ASIC extract
      </p>
    )
  }

  return (
    <p className="text-xs text-foreground/50">
      ASIC extract has <span className="tabular-nums">{shown(field, comparison.asic)}</span>
    </p>
  )
}
