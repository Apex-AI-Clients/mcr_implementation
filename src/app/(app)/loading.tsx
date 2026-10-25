import { Spinner } from '@/components/ui/Spinner'

/**
 * Shown the moment a link is clicked, while the next page is read on the
 * server: the sidebar and top bar stay, the page area shows this. Without it
 * the old page sits unchanged until the new one is ready, which feels like
 * the click did nothing.
 */
export default function Loading() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-6" role="status" aria-label="Loading">
      <div className="flex items-center gap-2 text-sm text-foreground/60">
        <Spinner size="sm" />
        Loading…
      </div>
      <div className="mt-6 space-y-3 animate-pulse" aria-hidden>
        <div className="h-6 w-64 rounded bg-surface" />
        <div className="h-4 w-40 rounded bg-surface" />
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="h-28 rounded-lg border border-border/60 bg-card" />
          ))}
        </div>
        <div className="mt-4 h-64 rounded-lg border border-border/60 bg-card" />
      </div>
    </div>
  )
}
