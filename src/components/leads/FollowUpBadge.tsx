import { Flag } from 'lucide-react'

interface FollowUpBadgeProps {
  /** Icon only, for the table's flag column. */
  compact?: boolean
}

/**
 * The amber flag. Shown when a lead is open and nothing has been recorded
 * against it inside the follow-up window.
 */
export function FollowUpBadge({ compact = false }: FollowUpBadgeProps) {
  if (compact) {
    return (
      <span title="Needs follow-up" className="inline-flex text-warning">
        <Flag className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="sr-only">Needs follow-up</span>
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-warning/15 px-2.5 py-0.5 text-xs font-medium text-warning">
      <Flag className="h-3 w-3" aria-hidden="true" />
      Needs follow-up
    </span>
  )
}
