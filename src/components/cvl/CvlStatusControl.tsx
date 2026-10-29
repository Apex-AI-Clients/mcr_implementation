'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { formatDate } from '@/lib/utils'
import { CVL_STATUSES, CVL_STATUS_LABELS, type CvlStatus } from '@/lib/cvl/cases'

interface CvlStatusControlProps {
  caseId: string
  status: CvlStatus
  formsPreparedAt: string | null
  printedAt: string | null
}

/**
 * Draft → Forms prepared → Printed, each step with its date
 * (PATCH /api/admin/cvl/[caseId]/status). The next step is one button; the
 * step before can be gone back to, which clears the later dates.
 */
export function CvlStatusControl({ caseId, status, formsPreparedAt, printedAt }: CvlStatusControlProps) {
  const router = useRouter()
  const [working, setWorking] = useState<CvlStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const index = CVL_STATUSES.indexOf(status)
  const next = CVL_STATUSES[index + 1] ?? null
  const previous = CVL_STATUSES[index - 1] ?? null
  const dates: Record<CvlStatus, string | null> = { draft: null, forms_prepared: formsPreparedAt, printed: printedAt }

  async function move(to: CvlStatus) {
    setError(null)
    setWorking(to)
    try {
      const res = await fetch(`/api/admin/cvl/${caseId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: to }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to update the status')
      }
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setWorking(null)
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <ol className="flex flex-wrap items-center gap-2 text-xs" aria-label="CVL status">
        {CVL_STATUSES.map((s, i) => {
          const done = i <= index
          return (
            <li key={s} className="flex items-center gap-2">
              {i > 0 && <span className="h-px w-6 bg-border" aria-hidden="true" />}
              <span
                aria-current={s === status ? 'step' : undefined}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${
                  s === status
                    ? 'border-accent/40 bg-accent/10 font-medium text-foreground'
                    : done
                      ? 'border-success/30 bg-success/10 text-foreground/80'
                      : 'border-border text-foreground/50'
                }`}
              >
                {done && i < index && <Check className="h-3 w-3 text-success" aria-hidden="true" />}
                {CVL_STATUS_LABELS[s]}
                {done && dates[s] ? <span className="tabular-nums text-foreground/50">{formatDate(dates[s]!)}</span> : null}
              </span>
            </li>
          )
        })}
      </ol>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {next && (
          <Button type="button" size="sm" onClick={() => move(next)} loading={working === next} disabled={working !== null}>
            Mark {CVL_STATUS_LABELS[next].toLowerCase()}
          </Button>
        )}
        {previous && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => move(previous)}
            loading={working === previous}
            disabled={working !== null}
          >
            Back to {CVL_STATUS_LABELS[previous].toLowerCase()}
          </Button>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    </div>
  )
}
