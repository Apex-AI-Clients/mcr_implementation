'use client'

import Link from 'next/link'
import { TrendingUp } from 'lucide-react'
import { Button } from '@/components/ui/Button'

interface Props {
  clientId: string
}

/**
 * Navigates to the SBR outcome prediction page. The page itself handles
 * prerequisite checks (lodgement analysis, financials extraction) and renders
 * the right empty/blocked state when an upstream step is missing.
 */
export function PredictOutcomeButton({ clientId }: Props) {
  return (
    <Link href={`/admin/clients/${clientId}/outcome-prediction`}>
      <Button variant="accent" size="sm">
        <TrendingUp className="h-3.5 w-3.5" />
        Predict SBR Outcome
      </Button>
    </Link>
  )
}
