import { Ban, Check } from 'lucide-react'
import { OFF_RAMP_STAGES, STAGE_META, STAGE_PATH } from '@/lib/leads/constants'
import { formatFullDate } from '@/lib/leads/format'
import type { Lead } from '@/types/leads'

interface StageProgressProps {
  lead: Lead
}

type StepState = 'done' | 'current' | 'pending' | 'abandoned'

/**
 * Where the lead has got to: Lead → Prospect → Client → Converted.
 *
 * Drawn as one continuous rail with the completed portion filled, rather than
 * as separate markers with arrows floating between them. The filled length is
 * the thing the eye reads first — how far along this is — and loose chevrons
 * could not carry that.
 *
 * Only the four progression stages are on the rail. "Non-proceeding" and "Do
 * not contact" are exits, not steps; a lead that stops shows the rail greyed
 * with the exit called out underneath, rather than as a step somebody is
 * working towards.
 *
 * Dates appear only where they are actually known: the lead's own created date
 * for the first step, and `stage_since` for the step it is on now.
 * Intermediate steps are left undated rather than guessed — the history
 * records when a stage change happened but not which stage it moved to, so
 * pairing the two would be invention.
 */
export function StageProgress({ lead }: StageProgressProps) {
  const abandoned = OFF_RAMP_STAGES.includes(lead.stage) ? lead.stage : null
  const currentIndex = abandoned ? -1 : STAGE_PATH.indexOf(lead.stage)
  const lastIndex = STAGE_PATH.length - 1

  function stateFor(index: number): StepState {
    if (abandoned) return 'abandoned'
    if (index < currentIndex) return 'done'
    if (index === currentIndex) return 'current'
    return 'pending'
  }

  function dateFor(index: number): string | null {
    if (index === 0) return lead.createdAt
    if (!abandoned && index === currentIndex) return lead.stageSince
    return null
  }

  /** A rail segment is filled once the step on its far side has been reached. */
  function railClass(reached: boolean): string {
    return `h-0.5 flex-1 rounded-full ${reached ? 'bg-accent' : 'bg-border'}`
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-foreground/40">Progress</p>
        {!abandoned && (
          <p className="text-xs tabular-nums text-foreground/40">
            Step {currentIndex + 1} of {STAGE_PATH.length}
          </p>
        )}
      </div>

      {/* Horizontal at every width — four short labels fit on a phone, and the
          rail is the whole point of the thing, so stacking it vertically would
          throw away what it is for. */}
      <ol
        aria-label="Stage progress"
        className="mt-4 flex items-start"
      >
        {STAGE_PATH.map((stage, index) => {
          const state = stateFor(index)
          const date = dateFor(index)
          return (
            <li key={stage} className="flex flex-1 flex-col items-center gap-2">
              {/* Half-rail, marker, half-rail — the halves of adjacent steps
                  meet to form one unbroken line across the row. The outer
                  halves are invisible rather than absent, so every marker
                  stays on the same centre. */}
              <div className="flex w-full items-center">
                <span
                  className={
                    index === 0
                      ? 'h-0.5 flex-1 invisible'
                      : railClass(!abandoned && index <= currentIndex)
                  }
                />
                <Marker state={state} index={index} />
                <span
                  className={
                    index === lastIndex
                      ? 'h-0.5 flex-1 invisible'
                      : railClass(!abandoned && index < currentIndex)
                  }
                />
              </div>

              <div className="min-w-0 px-1 text-center">
                <p
                  className={`text-xs leading-tight sm:text-sm ${
                    state === 'current'
                      ? 'font-medium text-foreground'
                      : state === 'done'
                        ? 'text-foreground/70'
                        : 'text-foreground/35'
                  }`}
                >
                  {STAGE_META[stage].label}
                </p>
                {date && (
                  <p className="mt-0.5 text-[10px] tabular-nums leading-tight text-foreground/40 sm:text-xs">
                    {formatFullDate(date)}
                  </p>
                )}
              </div>
            </li>
          )
        })}
      </ol>

      {abandoned && (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2.5">
          <Ban
            className={`h-4 w-4 shrink-0 ${
              abandoned === 'do_not_contact' ? 'text-destructive' : 'text-muted'
            }`}
            aria-hidden="true"
          />
          <p className="text-sm text-foreground/70">
            Stopped at{' '}
            <span className="font-medium text-foreground">{STAGE_META[abandoned].label}</span>
            <span aria-hidden="true"> · </span>
            <span className="tabular-nums text-foreground/40">
              {formatFullDate(lead.stageSince)}
            </span>
          </p>
        </div>
      )}
    </div>
  )
}

/**
 * The step's dot. A tick for what is done, the step number for what is not, so
 * the order survives without relying on position or colour alone.
 *
 * The current step gets a soft ring rather than a bigger circle — growing it
 * would shift the rail off-centre on that one step.
 */
function Marker({ state, index }: { state: StepState; index: number }) {
  const base =
    'relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-medium transition-colors'

  if (state === 'done') {
    return (
      <span className={`${base} bg-accent text-white`}>
        <Check className="h-4 w-4" aria-hidden="true" />
        <span className="sr-only">Completed</span>
      </span>
    )
  }

  if (state === 'current') {
    return (
      <span className={`${base} bg-accent text-white ring-4 ring-accent/25`}>
        {index + 1}
        <span className="sr-only"> (current stage)</span>
      </span>
    )
  }

  // Pending and abandoned look the same: neither has been reached. The stop
  // banner below says which of the two it is.
  return (
    <span className={`${base} border border-border bg-surface text-foreground/35`}>
      {index + 1}
    </span>
  )
}
