import { cn } from '@/lib/utils'

/** Placeholders shown while a section of the dashboard is read. */

function Bar({ className }: { className?: string }) {
  return <div className={cn('rounded bg-surface', className)} />
}

export function PanelSkeleton({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div aria-hidden="true" className={cn('flex animate-pulse flex-col gap-4 rounded-2xl border border-border bg-card p-6', className)}>
      <Bar className="h-4 w-40" />
      <Bar className="h-3 w-56" />
      {Array.from({ length: rows }, (_, i) => (
        <Bar key={i} className="h-8 w-full" />
      ))}
    </div>
  )
}

export function TilesSkeleton({ count = 4, height = 'h-36' }: { count?: number; height?: string }) {
  return (
    <div aria-hidden="true" className="grid animate-pulse gap-4 [grid-template-columns:repeat(auto-fit,minmax(240px,1fr))]">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={cn('rounded-2xl border border-border bg-card', height)} />
      ))}
    </div>
  )
}

export function SectionSkeleton({ panels = 2 }: { panels?: number }) {
  return (
    <div aria-hidden="true" className="flex flex-col gap-4">
      <div className="flex animate-pulse items-center justify-between border-b border-border pb-3">
        <Bar className="h-6 w-48" />
        <Bar className="h-4 w-20" />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        {Array.from({ length: panels }, (_, i) => (
          <PanelSkeleton key={i} rows={4} />
        ))}
      </div>
    </div>
  )
}

export function LineSkeleton() {
  return <div aria-hidden="true" className="h-4 w-80 max-w-full animate-pulse rounded bg-surface" />
}
