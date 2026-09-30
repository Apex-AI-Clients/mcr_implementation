'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SelectOption } from '@/components/ui/Select'

interface MultiSelectProps {
  id: string
  label?: string
  /** Shown on the button while nothing is chosen. */
  placeholder?: string
  options: SelectOption[]
  value: string[]
  onChange: (next: string[]) => void
  error?: string
  wrapperClassName?: string
}

/**
 * A dropdown where more than one option can be ticked.
 *
 * Looks like <Select> closed — same height, border and chevron — and opens a
 * list of tick boxes. A native <select multiple> was not an option: it renders
 * as an always-open list box on desktop, not a dropdown.
 *
 * The list stays open while options are ticked, and closes on a click outside,
 * on Escape (which returns focus to the button), or when focus leaves it. The
 * button shows what is chosen, in the options' own order, not the order ticked.
 */
export function MultiSelect({
  id,
  label,
  placeholder = 'Select',
  options,
  value,
  onChange,
  error,
  wrapperClassName,
}: MultiSelectProps) {
  const [open, setOpen] = useState(false)
  const wrapper = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const listId = useId()

  // Close on a press anywhere else.
  useEffect(() => {
    if (!open) return
    function handlePointerDown(event: PointerEvent) {
      if (wrapper.current && !wrapper.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [open])

  const chosen = options.filter((option) => value.includes(option.value))
  const summary = chosen.map((option) => option.label).join(', ')

  function toggle(optionValue: string) {
    onChange(
      value.includes(optionValue)
        ? value.filter((current) => current !== optionValue)
        : [...value, optionValue],
    )
  }

  return (
    <div className={cn('flex w-full flex-col gap-1.5', wrapperClassName)}>
      {label && (
        <label htmlFor={id} className="text-xs font-medium text-muted">
          {label}
        </label>
      )}
      <div
        ref={wrapper}
        className="relative"
        data-popover-open={open ? '' : undefined}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && open) {
            event.stopPropagation()
            setOpen(false)
            button.current?.focus()
          }
        }}
        onBlur={(event) => {
          // Tabbing out of the list closes it; moving between its options does not.
          if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
        }}
      >
        <button
          ref={button}
          id={id}
          type="button"
          aria-haspopup="true"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          onClick={() => setOpen((current) => !current)}
          className={cn(
            'flex h-10 w-full items-center rounded-lg border border-border bg-input-bg pl-3 pr-8 text-left text-sm text-foreground transition-colors focus:border-accent focus:outline-none focus-visible:ring-1 focus-visible:ring-accent',
            error && 'border-destructive focus:border-destructive',
          )}
        >
          <span className={cn('truncate', !summary && 'text-muted')}>{summary || placeholder}</span>
        </button>
        <ChevronDown
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted transition-transform',
            open && 'rotate-180',
          )}
        />

        {open && (
          <div
            id={listId}
            role="group"
            aria-label={label}
            // Keeps focus on the button while an option is clicked. Without it
            // the press blurs the button onto nothing, the blur handler closes
            // the list, and the click lands on a list that is already gone.
            onMouseDown={(event) => event.preventDefault()}
            className="absolute left-0 right-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-lg border border-border bg-card p-1 shadow-lg"
          >
            {options.map((option) => {
              const checked = value.includes(option.value)
              return (
                <label
                  key={option.value}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground transition-colors hover:bg-surface focus-within:bg-surface',
                    option.disabled && 'cursor-not-allowed opacity-50',
                  )}
                >
                  <input
                    type="checkbox"
                    className="peer sr-only"
                    checked={checked}
                    disabled={option.disabled}
                    onChange={() => toggle(option.value)}
                  />
                  <span
                    aria-hidden="true"
                    className={cn(
                      'flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-accent',
                      checked ? 'border-accent bg-accent text-white' : 'border-border bg-input-bg',
                    )}
                  >
                    {checked && <Check className="h-3 w-3" />}
                  </span>
                  {option.label}
                </label>
              )
            })}
          </div>
        )}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
