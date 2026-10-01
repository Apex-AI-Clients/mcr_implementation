'use client'

interface ManualEntryCheckboxProps {
  id: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}

/**
 * "Enter manually (don't search ABN Lookup)", one per section. Ticked, that
 * section's name box stops offering register matches (and, for the company,
 * the ABN-by-ACN check stops). Validation is the same either way.
 */
export function ManualEntryCheckbox({ id, checked, disabled, onChange }: ManualEntryCheckboxProps) {
  return (
    <label htmlFor={id} className="flex w-fit cursor-pointer items-center gap-2 text-xs text-muted">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="h-3.5 w-3.5 cursor-pointer accent-accent disabled:cursor-not-allowed"
      />
      Enter manually (don&rsquo;t search ABN Lookup)
    </label>
  )
}
