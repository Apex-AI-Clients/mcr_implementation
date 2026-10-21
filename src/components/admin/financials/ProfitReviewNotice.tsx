import { AlertTriangle } from 'lucide-react'
import { PROFIT_IDENTITY } from '@/lib/financials/checks'
import type { FinancialCheck } from '@/lib/financials/types'

/**
 * "Needs review" when a year's profit does not reconcile: profit before tax
 * against gross profit + other income − total expenses, or net profit after
 * distributions against profit − distributions (checks.ts, ±$5). Shown in
 * every deployment, unlike the full statement checks panel.
 */
export function ProfitReviewNotice({ checks }: { checks: FinancialCheck[] }) {
  const failures = checks.filter((c) => c.severity === 'warning' && c.group === PROFIT_IDENTITY)
  if (failures.length === 0) return null
  return (
    <div role="status" className="rounded-lg border border-warning/30 bg-warning/10 p-3">
      <p className="flex items-center gap-2 text-sm font-medium text-foreground">
        <AlertTriangle className="h-4 w-4 shrink-0 text-warning" aria-hidden />
        Needs review: the profit figures do not reconcile
      </p>
      <ul className="mt-2 ml-6 list-disc space-y-1 text-xs text-foreground/70">
        {failures.map((c, i) => (
          <li key={i}>
            {c.financialYear !== null && <span className="font-medium">{c.currentPeriod ? 'Current period' : `FY${c.financialYear}`}: </span>}
            {c.message}
          </li>
        ))}
      </ul>
    </div>
  )
}
