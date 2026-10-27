'use client'

import Link from 'next/link'
import { Activity } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import type { AtoAccountKind } from '@/lib/analysis/atoAccountKind'

export interface AtoAccountLink {
  id: string
  kind: AtoAccountKind
  label: string
}

/**
 * Under the income tax and superannuation guarantee slots: one button per
 * account to its analysis (the activity statement slot has the lodgement
 * analysis). Analyses run on upload; until one is stored, says so.
 */
export function AtoAccountButtons({
  clientId,
  kind,
  accounts,
  hasFiles,
}: {
  clientId: string
  kind: AtoAccountKind
  accounts: AtoAccountLink[]
  hasFiles: boolean
}) {
  const mine = accounts.filter((a) => a.kind === kind)
  if (!hasFiles) return null
  if (mine.length === 0) {
    return <p className="mt-3 ml-6.5 text-right text-xs text-foreground/50">Being analysed — refresh in a moment.</p>
  }
  return (
    <div className="mt-3 ml-6.5 flex flex-wrap justify-end gap-2">
      {mine.map((a) => (
        <Link key={a.id} href={`/clients/${clientId}/ato-accounts/${a.id}`}>
          <Button variant="primary" size="sm">
            <Activity className="h-3.5 w-3.5" />
            {a.label} analysis
          </Button>
        </Link>
      ))}
    </div>
  )
}
