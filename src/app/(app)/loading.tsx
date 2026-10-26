import { LoadingOverlay } from '@/components/ui/LoadingOverlay'

/**
 * Shown the moment a link is clicked, while the next page is read on the
 * server. Without it the old page sits unchanged until the new one is ready,
 * which feels like the click did nothing.
 *
 * A full-window overlay with the spinner in the middle, over a blurred
 * skeleton of the page — a spinner tucked in the corner of the page area was
 * easy to miss.
 */
export default function Loading() {
  return (
    <>
      <div className="mx-auto max-w-7xl px-4 py-6" aria-hidden>
        <div className="space-y-3 animate-pulse">
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

      <LoadingOverlay />
    </>
  )
}
