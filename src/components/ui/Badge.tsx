import { cn } from '@/lib/utils'

interface BadgeProps {
  variant?: 'success' | 'warning' | 'destructive' | 'muted' | 'accent'
  className?: string
  children: React.ReactNode
}

export function Badge({ variant = 'muted', className, children }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium',
        {
          'bg-success/15 text-success': variant === 'success',
          'bg-warning/15 text-warning': variant === 'warning',
          'bg-destructive/15 text-destructive': variant === 'destructive',
          'bg-surface text-muted': variant === 'muted',
          'bg-accent/15 text-accent': variant === 'accent',
        },
        className,
      )}
    >
      {children}
    </span>
  )
}
