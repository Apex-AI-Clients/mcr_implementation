'use client'

import { useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { Spinner } from '@/components/ui/Spinner'

interface Props {
  clientId: string
  /**
   * Changes whenever what the summary may be written from changes (the
   * "checked" tick, the confirmed mapping): the summary is asked for again.
   */
  inputsKey: string
}

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; text: string; withheld: boolean }
  | { kind: 'blocked'; message: string }
  | { kind: 'failed' }

/**
 * The AI summary of the comparison: written by Claude from the confirmed key
 * figures, as printed (src/lib/ai/financialsComparisonSummary.ts). Rendered
 * only while the AI features are on.
 */
export function ComparisonSummaryCard({ clientId, inputsKey }: Props) {
  // The answer for the inputs it was asked for: other inputs show "Writing…" until theirs arrives.
  const [answer, setAnswer] = useState<{ key: string; state: State } | null>(null)
  const state: State = answer?.key === inputsKey ? answer.state : { kind: 'loading' }

  useEffect(() => {
    let cancelled = false
    const setState = (next: State) => setAnswer({ key: inputsKey, state: next })
    void (async () => {
      try {
        const res = await fetch(`/api/admin/clients/${clientId}/financials-comparison/summary`, { method: 'POST' })
        const data = (await res.json().catch(() => ({}))) as { aiSummary?: string | null; model?: string; message?: string }
        if (cancelled) return
        if (!res.ok) setState({ kind: 'failed' })
        else if (data.aiSummary) setState({ kind: 'ready', text: data.aiSummary, withheld: (data.model ?? '').includes('figures withheld') })
        else setState({ kind: 'blocked', message: data.message ?? 'No summary yet.' })
      } catch {
        if (!cancelled) setState({ kind: 'failed' })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [clientId, inputsKey])

  return (
    <section className="rounded-lg border border-border/60 bg-surface/60 p-4 space-y-2">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
        <Sparkles className="h-3.5 w-3.5 text-accent" />
        Summary
      </h2>
      {state.kind === 'loading' && (
        <p className="flex items-center gap-2 text-xs text-foreground/60">
          <Spinner className="h-3.5 w-3.5" />
          Writing the summary…
        </p>
      )}
      {state.kind === 'ready' && (
        <>
          <p className="text-sm leading-relaxed text-foreground/85">{state.text}</p>
          <p className="text-xs text-foreground/50">
            {state.withheld
              ? 'Written by Claude; its figures could not be matched to the confirmed figures, so they are left out.'
              : 'Written by Claude from the confirmed key figures, as printed. Check it against the tables below.'}
          </p>
        </>
      )}
      {state.kind === 'blocked' && <p className="text-xs text-foreground/60">{state.message}</p>}
      {state.kind === 'failed' && <p className="text-xs text-foreground/60">The summary could not be written just now. It will be tried again next visit.</p>}
    </section>
  )
}
