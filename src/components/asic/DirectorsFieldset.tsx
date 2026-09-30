'use client'

import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { directorRowErrors, emptyDirectorRow, type DirectorRow } from '@/lib/asic/fill'

interface DirectorsFieldsetProps {
  idPrefix: string
  rows: DirectorRow[]
  onChange: (rows: DirectorRow[]) => void
  disabled?: boolean
  /** Show every row's error — after a save was attempted. Otherwise only rows that were left. */
  showErrors?: boolean
}

/**
 * The company's directors: one row each, a name and a date of birth.
 *
 * There can be more than one, so rows are added and removed. Both boxes are
 * optional as far as the form goes — a blank row is simply dropped on save —
 * but a row with a date and no name is asked for the name.
 *
 * The date of birth is typed and shown as DD/MM/YYYY. MM/YYYY and YYYY are
 * accepted too: ASIC is consulting on showing only the year of birth from July
 * 2027, and an extract that says "1970" has to fit in the box.
 */
export function DirectorsFieldset({
  idPrefix,
  rows,
  onChange,
  disabled,
  showErrors,
}: DirectorsFieldsetProps) {
  // Rows somebody has typed in and left, so an error appears when they move on
  // rather than on the first keystroke.
  const [touched, setTouched] = useState<ReadonlySet<number>>(new Set())
  const errors = directorRowErrors(rows)

  function update(index: number, change: Partial<DirectorRow>) {
    onChange(rows.map((row, i) => (i === index ? { ...row, ...change } : row)))
  }

  function remove(index: number) {
    onChange(rows.filter((_, i) => i !== index))
    // Indexes shift under the removed row; forget them rather than mislabel one.
    setTouched(new Set())
  }

  function touch(index: number) {
    setTouched((current) => new Set(current).add(index))
  }

  return (
    <fieldset className="space-y-3">
      <legend className="text-xs font-medium uppercase tracking-wide text-foreground/40">
        {rows.length > 1 ? 'Directors' : 'Director'}
      </legend>

      {rows.length === 0 && (
        <p className="text-xs text-foreground/50">
          None added. Add them by hand, or upload the ASIC extract above.
        </p>
      )}

      {rows.map((row, index) => {
        const number = index + 1
        const error = showErrors || touched.has(index) ? errors[index] : null
        return (
          <div key={index} className="space-y-1.5" onBlur={() => touch(index)}>
            <div className="grid grid-cols-[minmax(0,1fr)_9.5rem_auto] items-end gap-2">
              <Input
                id={`${idPrefix}-director-${number}-name`}
                label={`Director ${number} name`}
                value={row.name}
                autoComplete="off"
                disabled={disabled}
                onChange={(event) => update(index, { name: event.target.value })}
              />
              <Input
                id={`${idPrefix}-director-${number}-dob`}
                label={`Director ${number} date of birth`}
                value={row.dateOfBirth}
                placeholder="DD/MM/YYYY"
                inputMode="numeric"
                autoComplete="off"
                className={error ? 'border-destructive focus:border-destructive' : undefined}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${idPrefix}-director-${number}-error` : undefined}
                disabled={disabled}
                onChange={(event) => update(index, { dateOfBirth: event.target.value })}
              />
              <button
                type="button"
                aria-label={`Remove director ${number}`}
                disabled={disabled}
                onClick={() => remove(index)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-surface text-muted transition-colors hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            {error && (
              <p id={`${idPrefix}-director-${number}-error`} className="text-xs text-destructive">
                {error}
              </p>
            )}
          </div>
        )
      })}

      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={disabled}
        onClick={() => onChange([...rows, emptyDirectorRow()])}
      >
        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        Add director
      </Button>
    </fieldset>
  )
}
