import { cn } from '@/lib/utils'
import { ChevronDown } from 'lucide-react'
import { SelectHTMLAttributes, forwardRef } from 'react'

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

export interface SelectOptionGroup {
  label: string
  options: SelectOption[]
}

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  label?: string
  /**
   * Classes for the outer element. `className` reaches the <select>, which is
   * full-width inside this wrapper — so sizing the control in a toolbar means
   * sizing the wrapper, not the select.
   */
  wrapperClassName?: string
  error?: string
  /** Flat options. Ignored when `groups` is supplied. */
  options?: SelectOption[]
  /** Grouped options, rendered as <optgroup>. */
  groups?: SelectOptionGroup[]
  /** Optional leading item, e.g. "All stages". */
  placeholder?: string
  selectSize?: 'sm' | 'md'
}

/**
 * A native <select> underneath. Keyboard operation, type-ahead, screen-reader
 * semantics and the mobile picker all come free, and <optgroup> gives us the
 * Pipeline / Closed grouping without a custom listbox.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  (
    {
      className,
      wrapperClassName,
      label,
      error,
      options,
      groups,
      placeholder,
      selectSize = 'md',
      id,
      ...props
    },
    ref,
  ) => {
    const items = groups
      ? groups.map((group) => (
          <optgroup key={group.label} label={group.label}>
            {group.options.map((option) => (
              <option key={option.value} value={option.value} disabled={option.disabled}>
                {option.label}
              </option>
            ))}
          </optgroup>
        ))
      : (options ?? []).map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))

    return (
      <div className={cn('flex w-full flex-col gap-1.5', wrapperClassName)}>
        {label && (
          <label htmlFor={id} className="text-xs font-medium text-muted">
            {label}
          </label>
        )}
        <div className="relative">
          <select
            ref={ref}
            id={id}
            className={cn(
              'w-full appearance-none rounded-lg border border-border bg-input-bg pl-3 pr-8 text-sm text-foreground transition-colors focus:border-accent focus:outline-none focus-visible:ring-1 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50',
              selectSize === 'sm' ? 'h-8 text-xs' : 'h-10',
              error && 'border-destructive focus:border-destructive',
              className,
            )}
            {...props}
          >
            {placeholder && <option value="">{placeholder}</option>}
            {items}
          </select>
          <ChevronDown
            aria-hidden="true"
            className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted"
          />
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    )
  },
)
Select.displayName = 'Select'
