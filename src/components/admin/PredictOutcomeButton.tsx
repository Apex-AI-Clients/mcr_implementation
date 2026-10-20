'use client'

import Link from 'next/link'
import { Info, TrendingUp } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Tooltip } from '@/components/ui/Tooltip'

interface Props {
  clientId: string
  /** Every readiness item finished: Ready or Failed (readiness.ts). */
  canPredict: boolean
  /** What it is waiting for, one per item, shown on the info icon when it cannot open yet. */
  waitingFor: string[]
}

/**
 * Opens the SBR outcome prediction once everything it needs is in. Until
 * then it is disabled, with an info icon beside it whose tooltip says what it
 * is waiting for.
 */
export function PredictOutcomeButton({ clientId, canPredict, waitingFor }: Props) {
  if (!canPredict) {
    const reason = ['Waiting for:', ...waitingFor.map((line) => `• ${line}`)].join('\n')
    return (
      <div className="inline-flex items-center gap-1.5">
        <Button variant="accent" size="sm" disabled>
          <TrendingUp className="h-3.5 w-3.5" />
          Predict SBR Outcome
        </Button>
        <Tooltip
          content={reason}
          className="inline-flex cursor-help rounded-full p-1 text-foreground/40 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Info className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only">Why is Predict SBR Outcome not available? {waitingFor.join('; ')}.</span>
        </Tooltip>
      </div>
    )
  }

  return (
    <Link href={`/clients/${clientId}/outcome-prediction`}>
      <Button variant="accent" size="sm">
        <TrendingUp className="h-3.5 w-3.5" />
        Predict SBR Outcome
      </Button>
    </Link>
  )
}
