'use client'

import { useRef, useState } from 'react'
import { CalendarDays } from 'lucide-react'
import { dateField, isoFromTyped } from '@/lib/dates'

/**
 * A date box that always reads DD/MM/YYYY (Gabby, 24 Nov 2026). A browser's own date input shows
 * the computer's format (11/19/2026 on a US machine), so the box is text: type "19/11/2026" (or
 * an ISO date), or pick one from the calendar button. The value given and returned is ISO
 * ("2026-11-19"), or null when empty; text that is not yet a whole date is kept as typed and marked.
 */
export function DateInput({
  id,
  value,
  onChange,
  className = '',
  disabled = false,
  'aria-label': ariaLabel,
}: {
  id?: string
  value: string | null | undefined
  onChange: (iso: string | null) => void
  className?: string
  disabled?: boolean
  'aria-label'?: string
}) {
  const iso = isoFromTyped(String(value ?? '')) ?? null
  const [shown, setShown] = useState(() => ({ iso, text: iso ? dateField(iso) : String(value ?? '') }))
  // A value changed from outside (a pre-fill, "Copy from…", a reset): shown as DD/MM/YYYY. The
  // value this box itself just sent keeps the text as typed.
  if (shown.iso !== iso) {
    const keep = isoFromTyped(shown.text) === iso || (!iso && shown.text.trim() === '')
    setShown({ iso, text: keep ? shown.text : iso ? dateField(iso) : '' })
  }
  const text = shown.text
  const setText = (t: string) => setShown((s) => ({ ...s, text: t }))
  const picker = useRef<HTMLInputElement>(null)

  const invalid = text.trim() !== '' && isoFromTyped(text) === null

  return (
    <span className="relative inline-flex w-full items-center">
      <input
        id={id}
        type="text"
        inputMode="numeric"
        placeholder="DD/MM/YYYY"
        autoComplete="off"
        value={text}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        onChange={(e) => {
          const t = e.target.value
          setText(t)
          if (t.trim() === '') onChange(null)
          else {
            const next = isoFromTyped(t)
            if (next) onChange(next)
          }
        }}
        onBlur={() => {
          const next = isoFromTyped(text)
          if (next) setText(dateField(next))
        }}
        className={`${className} pr-9 tabular-nums ${invalid ? 'border-destructive' : ''}`}
      />
      <button
        type="button"
        disabled={disabled}
        aria-label="Pick a date"
        onClick={() => {
          const el = picker.current
          if (!el) return
          try {
            el.showPicker()
          } catch {
            el.click()
          }
        }}
        className="absolute right-1.5 rounded p-1 text-foreground/50 hover:text-foreground disabled:opacity-40"
      >
        <CalendarDays className="h-4 w-4" aria-hidden="true" />
      </button>
      {/* The browser's calendar, for picking only: never shown, so its format never is. */}
      <input
        ref={picker}
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        value={iso ?? ''}
        onChange={(e) => {
          const next = e.target.value || null
          setText(next ? dateField(next) : '')
          onChange(next)
        }}
        className="pointer-events-none absolute bottom-0 right-0 h-0 w-0 opacity-0"
      />
    </span>
  )
}
