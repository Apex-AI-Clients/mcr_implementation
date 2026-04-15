import { cn } from '@/lib/utils'

interface ProgressProps {
  value: number // 0–100
  className?: string
  showLabel?: boolean
}

export function Progress({ value, className, showLabel }: ProgressProps) {
  const clamped = Math.min(100, Math.max(0, value))
  const color =
    clamped === 100 ? 'bg-success' : clamped >= 50 ? 'bg-warning' : 'bg-accent'

  return (
    <div className={cn('flex items-center gap-3', className)}>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface">
        <div
          className={cn('h-full rounded-full transition-all duration-500', color)}
          style={{ width: `${clamped}%` }}
        />
      </div>
      {showLabel && (
        <span className="text-xs font-medium text-muted tabular-nums">
          {Math.round(clamped)}%
        </span>
      )}
    </div>
  )
}
