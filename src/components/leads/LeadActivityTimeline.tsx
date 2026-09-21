'use client'

import { useState } from 'react'
import { ArrowRightLeft, Mail, Pencil, PhoneCall, StickyNote, Target, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { useToast } from '@/components/ui/Toast'
import { useLeads } from '@/components/leads/LeadsStore'
import { ACTIVITY_TYPE_META } from '@/lib/leads/constants'
import { formatFullDate } from '@/lib/leads/format'
import type { LeadActivity, LeadActivityType } from '@/types/leads'

interface LeadActivityTimelineProps {
  activities: LeadActivity[]
  /**
   * Whether entries can be corrected or removed. False for the stage tab: a
   * stage change is the system's record that something happened, and editing
   * it would leave the timeline disagreeing with the stage it produced. A
   * mistaken stage change is fixed by changing the stage again.
   */
  editable?: boolean
}

const ICONS: Record<LeadActivityType, typeof StickyNote> = {
  note: StickyNote,
  call: PhoneCall,
  email: Mail,
  next_step: Target,
  stage_change: ArrowRightLeft,
}

/** History, newest first. */
export function LeadActivityTimeline({ activities, editable = false }: LeadActivityTimelineProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<LeadActivity | null>(null)

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
    <>
      <ol className="space-y-2">
        {activities.map((activity) => (
          <li key={activity.id} className="rounded-xl border border-border bg-card p-4">
            {editingId === activity.id ? (
              <EditRow activity={activity} onDone={() => setEditingId(null)} />
            ) : (
              <ReadRow
                activity={activity}
                // Belt and braces: the notes tab is the only editable one and
                // it never holds a stage change, but the API refuses these
                // too, so the button should not exist to be pressed.
                editable={editable && activity.type !== 'stage_change'}
                onEdit={() => setEditingId(activity.id)}
                onDelete={() => setDeleting(activity)}
              />
            )}
          </li>
        ))}
      </ol>

      <DeleteActivityDialog activity={deleting} onClose={() => setDeleting(null)} />
    </>
  )
}

function ReadRow({
  activity,
  editable,
  onEdit,
  onDelete,
}: {
  activity: LeadActivity
  editable: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  const Icon = ICONS[activity.type]

  return (
    <div className="flex gap-3">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface">
        <Icon className="h-3.5 w-3.5 text-muted" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className="text-xs font-medium text-foreground/70">
            {ACTIVITY_TYPE_META[activity.type].label}
          </span>
          <span className="flex items-center gap-1.5 text-xs tabular-nums text-foreground/40">
            {activity.author}
            <span aria-hidden="true">·</span>
            {formatFullDate(activity.createdAt)}
            {editable && (
              <>
                {/* Muted until hovered: these sit on every entry, and a bin
                    icon should not be the loudest thing on the timeline. */}
                <IconButton
                  label={`Edit ${ACTIVITY_TYPE_META[activity.type].label.toLowerCase()} from ${formatFullDate(activity.createdAt)}`}
                  onClick={onEdit}
                  tone="neutral"
                >
                  <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                </IconButton>
                <IconButton
                  label={`Delete ${ACTIVITY_TYPE_META[activity.type].label.toLowerCase()} from ${formatFullDate(activity.createdAt)}`}
                  onClick={onDelete}
                  tone="destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </IconButton>
              </>
            )}
          </span>
        </div>
        <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-foreground/80">
          {activity.body}
        </p>
      </div>
    </div>
  )
}

function IconButton({
  label,
  onClick,
  tone,
  children,
}: {
  label: string
  onClick: () => void
  tone: 'neutral' | 'destructive'
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`inline-flex h-6 w-6 items-center justify-center rounded-md text-foreground/30 transition-colors focus-visible:outline-none focus-visible:ring-2 ${
        tone === 'destructive'
          ? 'hover:bg-destructive/10 hover:text-destructive focus-visible:ring-destructive'
          : 'hover:bg-surface hover:text-foreground focus-visible:ring-accent'
      }`}
    >
      {children}
    </button>
  )
}

/** Inline correction. Escape cancels, so nothing needs a second button press. */
function EditRow({ activity, onDone }: { activity: LeadActivity; onDone: () => void }) {
  const { editActivity } = useLeads()
  const { toast } = useToast()
  const [value, setValue] = useState(activity.body)
  const [saving, setSaving] = useState(false)

  const unchanged = value.trim() === activity.body.trim()

  async function save() {
    if (!value.trim() || unchanged) return onDone()
    setSaving(true)
    try {
      await editActivity(activity.id, value)
      toast('Note updated.')
      onDone()
    } catch {
      // The store has already put the original wording back.
      toast("That didn't save. Please try again.", { tone: 'error' })
      setSaving(false)
    }
  }

  return (
    <div className="space-y-2">
      <label className="sr-only" htmlFor={`edit-${activity.id}`}>
        Edit {ACTIVITY_TYPE_META[activity.type].label.toLowerCase()}
      </label>
      <textarea
        id={`edit-${activity.id}`}
        autoFocus
        rows={3}
        value={value}
        disabled={saving}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onDone()
        }}
        className="w-full rounded-lg border border-border bg-input-bg p-2.5 text-sm text-foreground focus:border-accent focus:outline-none"
      />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onDone} disabled={saving}>
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={save}
          loading={saving}
          disabled={!value.trim() || unchanged}
        >
          Save
        </Button>
      </div>
    </div>
  )
}

/**
 * Confirmation for removing one entry.
 *
 * Says what it is rather than "Are you sure?", because the timeline is the
 * only record of a call that was made.
 */
function DeleteActivityDialog({
  activity,
  onClose,
}: {
  activity: LeadActivity | null
  onClose: () => void
}) {
  const { deleteActivity } = useLeads()
  const { toast } = useToast()
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [prevId, setPrevId] = useState<string | null>(activity?.id ?? null)
  if ((activity?.id ?? null) !== prevId) {
    setPrevId(activity?.id ?? null)
    setWorking(false)
    setError(null)
  }

  async function confirm() {
    if (!activity) return
    setWorking(true)
    setError(null)
    try {
      await deleteActivity(activity.id)
      toast('Entry deleted.')
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete. Nothing was changed.')
      setWorking(false)
    }
  }

  const label = activity ? ACTIVITY_TYPE_META[activity.type].label.toLowerCase() : 'entry'

  return (
    <Dialog
      open={!!activity}
      onClose={working ? () => {} : onClose}
      title={`Delete this ${label}?`}
      description="This cannot be undone."
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose} disabled={working}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" onClick={confirm} loading={working}>
            Delete
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm text-foreground/70">
        {activity && (
          <p className="rounded-lg border border-border bg-surface p-3 whitespace-pre-wrap text-foreground/80">
            {activity.body}
          </p>
        )}
        {activity?.type === 'next_step' && (
          <p>
            This is a next step. If it is the one on the record, the record falls back to the
            previous one.
          </p>
        )}
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  )
}
