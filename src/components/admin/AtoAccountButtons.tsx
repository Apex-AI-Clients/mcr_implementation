'use client'

import Link from 'next/link'
import { Activity } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import type { AtoAccountKind } from '@/lib/analysis/atoAccountKind'

const PLAIN_NAME: Partial<Record<AtoAccountKind, string>> = {
  income_tax: 'Income tax account',
  super_guarantee: 'Superannuation guarantee account',
}

export interface AtoAccountLink {
  id: string
  kind: AtoAccountKind
  label: string
}

/**
 * Under the income tax and superannuation guarantee slots: one button per
 * account to its analysis (the activity statement slot has the lodgement
 * analysis). Analyses run on upload; until one is stored, says so. One
 * account of the kind gets the plain name; with two, the ATO's own names
 * ("Income tax 001", "Income tax 002") tell them apart.
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
            {mine.length === 1 ? (PLAIN_NAME[kind] ?? a.label) : a.label} analysis
          </Button>
        </Link>
      ))}
    </div>
  )
}
