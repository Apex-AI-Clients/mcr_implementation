import { ArrowRightLeft, Mail, PhoneCall, StickyNote, Target } from 'lucide-react'
import { ACTIVITY_TYPE_META } from '@/lib/leads/constants'
import { formatFullDate } from '@/lib/leads/format'
import type { LeadActivity, LeadActivityType } from '@/types/leads'

interface LeadActivityTimelineProps {
  activities: LeadActivity[]
}

const ICONS: Record<LeadActivityType, typeof StickyNote> = {
  note: StickyNote,
  call: PhoneCall,
  email: Mail,
  next_step: Target,
  stage_change: ArrowRightLeft,
}

/** History, newest first. */
export function LeadActivityTimeline({ activities }: LeadActivityTimelineProps) {
  if (activities.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border py-10 text-center">
        <p className="text-sm text-foreground/50">
          Nothing recorded yet. Save a note or log a call above.
        </p>
      </div>
    )
  }

  return (
    <ol className="space-y-2">
      {activities.map((activity) => {
        const Icon = ICONS[activity.type]
        return (
          <li
            key={activity.id}
            className="flex gap-3 rounded-xl border border-border bg-card p-4"
          >
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface">
              <Icon className="h-3.5 w-3.5 text-muted" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="text-xs font-medium text-foreground/70">
                  {ACTIVITY_TYPE_META[activity.type].label}
                </span>
                <span className="text-xs tabular-nums text-foreground/40">
                  {activity.author}
                  <span aria-hidden="true"> · </span>
                  {formatFullDate(activity.createdAt)}
                </span>
              </div>
              <p className="mt-1.5 text-sm leading-relaxed text-foreground/80">{activity.body}</p>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
