'use client'

import { useId, useMemo, useRef, useState } from 'react'
import { LeadActivityTimeline } from '@/components/leads/LeadActivityTimeline'
import { StageProgress } from '@/components/leads/StageProgress'
import type { Lead, LeadActivity } from '@/types/leads'

interface LeadHistoryProps {
  lead: Lead
  activities: LeadActivity[]
}

type TabKey = 'notes' | 'stage'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'notes', label: 'Notes' },
  { key: 'stage', label: 'Stage' },
]

/**
 * The record's history, split in two.
 *
 * One list mixed "called them back" with "moved to Prospect", which read as
 * noise in both directions — the notes are what somebody said and did, the
 * stage changes are where the lead got to. Separating them lets the stage tab
 * lead with the track rather than with prose.
 *
 * Notes covers everything a person composed: notes, calls, emails and next
 * steps. Only `stage_change` — which the system writes — goes to the other
 * tab.
 */
export function LeadHistory({ lead, activities }: LeadHistoryProps) {
  const [active, setActive] = useState<TabKey>('notes')
  const baseId = useId()
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({})

  const { notes, stageChanges } = useMemo(
    () => ({
      notes: activities.filter((activity) => activity.type !== 'stage_change'),
      stageChanges: activities.filter((activity) => activity.type === 'stage_change'),
    }),
    [activities],
  )

  const counts: Record<TabKey, number> = {
    notes: notes.length,
    stage: stageChanges.length,
  }

  /**
   * Arrow keys move between tabs, as the tablist pattern expects — without it
   * a keyboard user has to tab through every tab to reach the panel.
   */
  function handleKeyDown(event: React.KeyboardEvent, index: number) {
    const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (delta === 0) return
    event.preventDefault()
    const next = TABS[(index + delta + TABS.length) % TABS.length]
    setActive(next.key)
    tabRefs.current[next.key]?.focus()
  }

  return (
    <div>
      {/* Full width, split evenly: each tab takes half, so the underline marks
          out its whole half rather than just the width of the word. */}
      <div
        role="tablist"
        aria-label="Lead history"
        className="flex w-full justify-between border-b border-border"
      >
        {TABS.map((tab, index) => {
          const selected = tab.key === active
          return (
            <button
              key={tab.key}
              ref={(node) => {
                tabRefs.current[tab.key] = node
              }}
              role="tab"
              type="button"
              id={`${baseId}-tab-${tab.key}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${tab.key}`}
              // Only the selected tab is in the tab order; the arrows move
              // between them from there.
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(tab.key)}
              onKeyDown={(event) => handleKeyDown(event, index)}
              className={`-mb-px flex-1 border-b-2 px-3 py-2.5 text-center text-sm transition-colors ${
                selected
                  ? 'border-accent font-medium text-foreground'
                  : 'border-transparent text-foreground/50 hover:text-foreground'
              }`}
            >
              {tab.label}
              {counts[tab.key] > 0 && (
                <span className="ml-1.5 tabular-nums text-foreground/40">
                  {counts[tab.key]}
                </span>
              )}
            </button>
          )
        })}
      </div>

      <div
        role="tabpanel"
        id={`${baseId}-panel-notes`}
        aria-labelledby={`${baseId}-tab-notes`}
        hidden={active !== 'notes'}
        className="pt-4"
      >
        {/* Editable here only. Stage changes on the other tab are the
            system's record of what happened. */}
        <LeadActivityTimeline activities={notes} editable />
      </div>

      <div
        role="tabpanel"
        id={`${baseId}-panel-stage`}
        aria-labelledby={`${baseId}-tab-stage`}
        hidden={active !== 'stage'}
        className="space-y-4 pt-4"
      >
        {/* The track first, then the individual changes as cards — the same
            cards the single list used, so nothing about them had to change. */}
        <StageProgress lead={lead} />
        {stageChanges.length > 0 ? (
          <LeadActivityTimeline activities={stageChanges} />
        ) : (
          <div className="rounded-xl border border-dashed border-border py-10 text-center">
            <p className="text-sm text-foreground/50">
              No stage changes yet. Moving the stage records one here.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
