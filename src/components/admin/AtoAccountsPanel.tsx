import Link from 'next/link'
import { AlertTriangle, ChevronRight } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { cn } from '@/lib/utils'
import type { AtoAccountsOverview } from '@/lib/analysis/atoAccount/store'
import type { AtoAccountKind } from '@/lib/analysis/atoAccountKind'

const AUD = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' })
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const longDate = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return `${d} ${MONTHS[m - 1]} ${y}`
}

/** "$91,591.70 DR" / "$1,200.00 CR": as the ATO prints a balance. */
export function drCr(value: number): string {
  if (value === 0) return AUD.format(0)
  return `${AUD.format(Math.abs(value))} ${value > 0 ? 'DR' : 'CR'}`
}

const KIND_LABEL: Record<AtoAccountKind, string> = {
  activity_statement: 'Activity statement',
  income_tax: 'Income tax',
  super_guarantee: 'Superannuation guarantee',
}

/**
 * "ATO accounts" on the client page: each ATO account once (its newest file),
 * with the balance and date the ATO printed, and the total ATO debt — the
 * accounts' balances added up, credits netted off as the ATO offsets them.
 * Each line opens its analysis: the activity statement's lodgement analysis,
 * or the income tax / super guarantee summary.
 */
export function AtoAccountsPanel({ clientId, overview }: { clientId: string; overview: AtoAccountsOverview }) {
  if (overview.accounts.length === 0) return null
  return (
    <Card className="mb-6">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-foreground">ATO accounts</h2>
        {overview.totalDebt !== null && (
          <p className="text-sm text-foreground/70">
            Total ATO debt{' '}
            <span className={cn('font-semibold tabular-nums', overview.totalDebt > 0 ? 'text-warning' : 'text-success')}>
              {drCr(overview.totalDebt)}
            </span>
          </p>
        )}
      </div>
      <ul className="divide-y divide-border/40 rounded-lg border border-border">
        {overview.accounts.map((a) => (
          <li key={a.id}>
            <Link
              href={
                a.kind === 'activity_statement'
                  ? `/clients/${clientId}/lodgement-compliance-analysis`
                  : `/clients/${clientId}/ato-accounts/${a.id}`
              }
              className="flex items-center justify-between gap-3 px-3 py-2 text-xs transition-colors hover:bg-surface/60"
            >
              <span className="min-w-0">
                <span className="font-medium text-foreground">{a.label}</span>
                <span className="text-foreground/40"> · {KIND_LABEL[a.kind]}</span>
                {a.olderFiles > 0 && (
                  <span className="text-foreground/40">
                    {' '}
                    · newest of {a.olderFiles + 1} files
                  </span>
                )}
                {a.needsReview && !a.reviewedAt && (
                  <Badge variant="warning" className="ml-2">
                    Needs review
                  </Badge>
                )}
                {a.entityMatches === false && (
                  <span className="ml-2 inline-flex items-center gap-1 text-warning">
                    <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                    Different entity
                  </span>
                )}
              </span>
              <span className="flex shrink-0 items-center gap-2 tabular-nums">
                <span className="text-right">
                  <span className="block font-medium text-foreground">{a.balance === null ? 'No balance' : drCr(a.balance)}</span>
                  {a.balanceDate && <span className="block text-foreground/40">at {longDate(a.balanceDate)}</span>}
                </span>
                <ChevronRight className="h-3.5 w-3.5 text-foreground/30" aria-hidden="true" />
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-foreground/40">
        Each account&rsquo;s newest balance as the ATO printed it; the total nets credits off, as the ATO offsets them.
      </p>
    </Card>
  )
}
