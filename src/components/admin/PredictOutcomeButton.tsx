'use client'

import Link from 'next/link'
import { TrendingUp } from 'lucide-react'
import { Button } from '@/components/ui/Button'

interface Props {
  clientId: string
  /** Every readiness item Ready, or Needs review and reviewed (readiness.ts). */
  canPredict: boolean
  /** What it is waiting for, one per item, shown when it cannot open yet. */
  waitingFor: string[]
}

/**
 * Opens the SBR outcome prediction once everything it needs is in. Until
 * then it is disabled and says what it is waiting for: everything is worked
 * out before staff get there, so the prediction itself is instant.
 */
export function PredictOutcomeButton({ clientId, canPredict, waitingFor }: Props) {
  if (!canPredict) {
    return (
      <div className="flex flex-col items-end gap-1">
        <Button variant="accent" size="sm" disabled aria-describedby="predict-waiting">
          <TrendingUp className="h-3.5 w-3.5" />
          Predict SBR Outcome
        </Button>
        <p id="predict-waiting" className="max-w-[320px] text-right text-xs text-foreground/50">
          Waiting for {waitingFor.join('; ')}.
        </p>
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
