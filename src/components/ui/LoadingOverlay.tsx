import { Spinner } from '@/components/ui/Spinner'

interface LoadingOverlayProps {
  /** What is happening, e.g. "Archiving client…". */
  label?: string
}

/**
 * Full-window wait screen: the page blurred behind, a spinner in the middle.
 *
 * For page loads and for actions that change or leave the page (archive,
 * delete, convert), where a spinner inside one button is easy to miss and the
 * rest of the screen would otherwise stay clickable. Sits above dialogs
 * (z-50), so a confirm dialog that started the action is covered too.
 */
export function LoadingOverlay({ label = 'Loading…' }: LoadingOverlayProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-primary/40 backdrop-blur-sm"
    >
      <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card px-8 py-6 shadow-lg">
        <Spinner size="lg" />
        <span className="text-sm text-foreground/70">{label}</span>
      </div>
    </div>
  )
}
