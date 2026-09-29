import { cn } from '@/lib/utils'
import { InputHTMLAttributes, ReactNode, forwardRef } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  /** Shown between the field and its error, so an error never moves. */
  hint?: ReactNode
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, hint, id, ...props }, ref) => {
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={id} className="text-xs font-medium text-muted">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={id}
          className={cn(
            'h-10 w-full rounded-lg border border-border bg-input-bg px-3 text-sm text-foreground placeholder:text-muted transition-colors focus:border-accent focus:outline-none',
            error && 'border-destructive focus:border-destructive',
            className,
          )}
          {...props}
        />
        {hint}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    )
  },
)
Input.displayName = 'Input'
