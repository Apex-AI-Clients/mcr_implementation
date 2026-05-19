'use client'

import Link from 'next/link'
import { BarChart3 } from 'lucide-react'
import { Button } from '@/components/ui/Button'

interface Props {
  clientId: string
  documentCount: number
}

/**
 * Rendered inside the historical-financials card of DocumentStatusGrid.
 * Navigates to the comparison page. Renders nothing if fewer than 2 PDFs
 * are present — comparison needs at least two years.
 */
export function CompareFinancialsButton({ clientId, documentCount }: Props) {
  if (documentCount < 2) return null

  return (
    <div className="mt-3 ml-6.5 flex justify-end">
      <Link href={`/admin/clients/${clientId}/financials-comparison`}>
        <Button variant="primary" size="sm">
          <BarChart3 className="h-3.5 w-3.5" />
          Compare Financials
        </Button>
      </Link>
    </div>
  )
}
