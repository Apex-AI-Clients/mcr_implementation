'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { useLeads } from '@/components/leads/LeadsStore'
import { ACTIVITY_TYPE_META, COMPOSER_TYPES } from '@/lib/leads/constants'
import type { LeadActivityType } from '@/types/leads'

interface LeadActivityFormProps {
  leadId: string
}

/**
 * Composer. Saving anything here is a recorded human action, so it resets the
 * follow-up clock — that is the whole point of the control.
 */
export function LeadActivityForm({ leadId }: LeadActivityFormProps) {
  const { logActivity } = useLeads()
  const { toast } = useToast()
  const [type, setType] = useState<LeadActivityType>('note')
  const [body, setBody] = useState('')

  const meta = ACTIVITY_TYPE_META[type]
  const canSave = body.trim().length > 0

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!canSave) return
    logActivity(leadId, type, body)
    setBody('')
    toast(meta.toast)
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-xl border border-border bg-card p-4">
      <div
        role="radiogroup"
        aria-label="Activity type"
        className="mb-3 flex flex-wrap items-center gap-1.5"
      >
        {COMPOSER_TYPES.map((option) => {
          const selected = option === type
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setType(option)}
              className={`h-8 rounded-lg border px-3 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                selected
                  ? 'border-accent/40 bg-accent/10 font-medium text-accent'
                  : 'border-border bg-surface text-muted hover:text-foreground'
              }`}
            >
              {ACTIVITY_TYPE_META[option].label}
            </button>
          )
        })}
      </div>

      <label htmlFor="activity-body" className="sr-only">
        {meta.label}
      </label>
      <textarea
        id="activity-body"
        rows={3}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        placeholder={
          type === 'next_step' ? 'What happens next?' : 'What happened?'
        }
        className="w-full resize-y rounded-lg border border-border bg-input-bg px-3 py-2 text-sm text-foreground transition-colors placeholder:text-muted focus:border-accent focus:outline-none"
      />

      <div className="mt-3 flex justify-end">
        <Button type="submit" size="sm" disabled={!canSave}>
          {meta.saveLabel}
        </Button>
      </div>
    </form>
  )
}
