'use client'

import Link from 'next/link'
import { Activity } from 'lucide-react'
import { Button } from '@/components/ui/Button'

interface Props {
  clientId: string
  /** The client page its links go under: /clients/{id} (SBR, the default) or /cvl/{id} (CVL). */
  basePath?: string
}

export function LodgementAnalysisButton({ clientId, basePath = `/clients/${clientId}` }: Props) {
  return (
    <div className="mt-3 ml-6.5 flex justify-end">
      <Link href={`${basePath}/lodgement-compliance-analysis`}>
        <Button variant="primary" size="sm">
          <Activity className="h-3.5 w-3.5" />
          Lodgement Compliance Analysis
        </Button>
      </Link>
    </div>
  )
}
